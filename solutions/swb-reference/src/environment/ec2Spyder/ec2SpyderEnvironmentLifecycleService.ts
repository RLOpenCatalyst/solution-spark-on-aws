/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { ElasticLoadBalancingV2 } from '@aws-sdk/client-elastic-load-balancing-v2';
import { Route53 } from '@aws-sdk/client-route-53';
import { AwsService } from '@aws/workbench-core-base';
import {
  EnvironmentLifecycleService,
  EnvironmentLifecycleHelper,
  EnvironmentService
} from '@aws/workbench-core-environments';
import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';

export default class Ec2SpyderEnvironmentLifecycleService implements EnvironmentLifecycleService {
  public helper: EnvironmentLifecycleHelper;
  public aws: AwsService;
  public envService: EnvironmentService;
  private _envType: string = 'ec2Spyder';

  public constructor() {
    this.helper = new EnvironmentLifecycleHelper();
    this.aws = new AwsService({ region: process.env.AWS_REGION!, ddbTableName: process.env.STACK_NAME! });
    this.envService = new EnvironmentService({ TABLE_NAME: process.env.STACK_NAME! });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async launch(envMetadata: any): Promise<{ [id: string]: string }> {
    const cidr = _.find(envMetadata.ETC.params, { key: 'CIDR' })!.value!;
    const instanceSize = _.find(envMetadata.ETC.params, { key: 'InstanceType' })!.value!;
    const keyName = _.find(envMetadata.ETC.params, { key: 'KeyName' })!.value!;
    const secureConnectionMetadata = JSON.parse(process.env.SECURE_CONNECTION_METADATA!);

    const { albSecurityGroupId, listenerArn, partnerDomain } = secureConnectionMetadata;

    const { datasetsBucketArn, mainAccountRegion, mainAccountId, mainAcctEncryptionArn } =
      await this.helper.getCfnOutputs();
    const { s3Mounts, iamPolicyDocument } = await this.helper.getDatasetsToMount(
      envMetadata.datasetIds,
      envMetadata,
      mainAcctEncryptionArn
    );

    const listenerRulePriority = await this.calculateRulePriority(envMetadata.id!);
    const applicationUrl = `${this._envType}-${envMetadata.id!}.${partnerDomain}`;
    await this.createRoute53Record(applicationUrl, secureConnectionMetadata);

    const ssmParameters = {
      InstanceName: [`ec2spyderinstance-${Date.now()}`],
      VPC: [envMetadata.PROJ.vpcId],
      Subnet: [envMetadata.PROJ.subnetId],
      ProvisioningArtifactId: [envMetadata.ETC.provisioningArtifactId],
      ProductId: [envMetadata.ETC.productId],
      Namespace: [`${this._envType}-${Date.now()}`],
      EncryptionKeyArn: [envMetadata.PROJ.encryptionKeyArn],
      CIDR: [cidr],
      InstanceType: [instanceSize],
      DatasetsBucketArn: [datasetsBucketArn],
      EnvId: [envMetadata.id],
      EnvironmentInstanceFiles: [envMetadata.PROJ.environmentInstanceFiles],
      IamPolicyDocument: [iamPolicyDocument],
      S3Mounts: [s3Mounts],
      KeyName: [keyName],
      ALBSecurityGroup: [albSecurityGroupId],
      ListenerArn: [listenerArn],
      ListenerRulePriority: [listenerRulePriority],
      ApplicationUrl: [applicationUrl],
      MainAccountKeyArn: [mainAcctEncryptionArn],
      MainAccountRegion: [mainAccountRegion],
      MainAccountId: [mainAccountId]
    };

    await this.helper.launch({
      ssmParameters,
      operation: 'Launch',
      envType: this._envType,
      envMetadata
    });

    return { ...envMetadata, status: 'PENDING' };
  }

  public async terminate(envId: string): Promise<{ [id: string]: string }> {
    // Get value from env in DDB
    const envDetails = await this.envService.getEnvironment(envId, true);
    const provisionedProductId = envDetails.provisionedProductId!; // This is updated by status handler

    const secureConnectionMetadata = JSON.parse(process.env.SECURE_CONNECTION_METADATA!);
    const { partnerDomain } = secureConnectionMetadata;
    const applicationUrl = `${this._envType}-${envId}.${partnerDomain}`;
    await this.deleteRoute53Record(applicationUrl, secureConnectionMetadata);

    const ssmParameters = {
      ProvisionedProductId: [provisionedProductId],
      TerminateToken: [uuidv4()],
      EnvId: [envId]
    };

    // Execute termination doc
    await this.helper.executeSSMDocument({
      ssmParameters,
      operation: 'Terminate',
      envType: this._envType,
      envMgmtRoleArn: envDetails.PROJ.envMgmtRoleArn,
      externalId: envDetails.PROJ.externalId
    });

    // Delete access point(s) for this workspace
    await this.helper.removeAccessPoints(envDetails);

    // Store env row in DDB
    await this.envService.updateEnvironment(envId, { status: 'TERMINATING' });

    return { envId, status: 'TERMINATING' };
  }

  public async start(envId: string): Promise<{ [id: string]: string }> {
    // Get value from env in DDB
    const envDetails = await this.envService.getEnvironment(envId, true);
    const instanceName = envDetails.instanceId!;

    // Assume hosting account EnvMgmt role
    const hostAwsSdk = await this.helper.getAwsSdkForEnvMgmtRole({
      envMgmtRoleArn: envDetails.PROJ.envMgmtRoleArn,
      externalId: envDetails.PROJ.externalId,
      operation: 'Start',
      envType: this._envType
    });

    await hostAwsSdk.clients.ec2.startInstances({ InstanceIds: [instanceName] });

    // Store env row in DDB
    await this.envService.updateEnvironment(envId, { status: 'STARTING' });

    return { envId, status: 'STARTING' };
  }

  public async stop(envId: string): Promise<{ [id: string]: string }> {
    // Get value from env in DDB
    const envDetails = await this.envService.getEnvironment(envId, true);
    const instanceName = envDetails.instanceId!;

    // Assume hosting account EnvMgmt role
    const hostAwsSdk = await this.helper.getAwsSdkForEnvMgmtRole({
      envMgmtRoleArn: envDetails.PROJ.envMgmtRoleArn,
      externalId: envDetails.PROJ.externalId,
      operation: 'Stop',
      envType: this._envType
    });

    await hostAwsSdk.clients.ec2.stopInstances({ InstanceIds: [instanceName] });

    envDetails.status = 'STOPPING';

    // Store env row in DDB
    await this.envService.updateEnvironment(envId, { status: 'STOPPING' });

    return { envId, status: 'STOPPING' };
  }

  public async calculateRulePriority(envId: string): Promise<string> {
    // Get value from env in DDB
    const envDetails = await this.envService.getEnvironment(envId, true);
    const secureConnectionMetadata = JSON.parse(process.env.SECURE_CONNECTION_METADATA!);
    if (!secureConnectionMetadata) {
      throw new Error('Secure connection metadata not found. Please contact the administrator');
    }
    // Assume hosting account EnvMgmt role
    const elbv2 = await this.getElbSDKForRole({
      roleArn: envDetails.PROJ.envMgmtRoleArn,
      roleSessionName: `RulePriority-${this._envType}-${Date.now()}`,
      externalId: envDetails.PROJ.externalId,
      region: process.env.AWS_REGION!,
    });

    const params = {
      ListenerArn: secureConnectionMetadata.listenerArn,
    };

    const response = await elbv2.describeRules(params);
    const rules = response.Rules!;
    // Returns list of priorities, returns 0 for default rule
    const priorities = _.map(rules, rule => {
      return rule.IsDefault ? 0 : _.toInteger(rule.Priority);
    });
    return (_.max(priorities)! + 1).toString();;
  }

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  public async createRoute53Record(applicationUrl: string, secureConnectionMetadata?: any): Promise<void> {
    const { hostedZoneId, albDnsName } = secureConnectionMetadata;
    await this.changeResourceRecordSets('CREATE', hostedZoneId, applicationUrl, 'CNAME', albDnsName);
    console.log('Created Route53 record')
  }

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  public async deleteRoute53Record(applicationUrl: string, secureConnectionMetadata?: any): Promise<void> {
    const { hostedZoneId, albDnsName } = secureConnectionMetadata;
    await this.changeResourceRecordSets('DELETE', hostedZoneId, applicationUrl, 'CNAME', albDnsName);
    console.log('Deleted Route53 record')
  }

  public async changeResourceRecordSets(
    action: string, hostedZoneId: string, subdomain: string, recordType: string, recordValue: string
  ): Promise<void> {
    const route53Client = await this.getRoute53SDKForBase();
    const params = {
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: action,
            ResourceRecordSet: {
              Name: subdomain,
              Type: recordType,
              TTL: 300,
              ResourceRecords: [{ Value: recordValue }],
            },
          },
        ],
      },
    };
    await route53Client.changeResourceRecordSets(params);
  }

  public async getElbSDKForRole(params: {
    roleArn: string;
    roleSessionName: string;
    externalId?: string;
    region: string;
  }): Promise<ElasticLoadBalancingV2> {
    const { Credentials } = await this.aws.clients.sts.assumeRole({
      RoleArn: params.roleArn,
      RoleSessionName: params.roleSessionName,
      ExternalId: params.externalId
    });
    if (Credentials) {
      return new ElasticLoadBalancingV2({
        region: params.region,
        credentials: {
          accessKeyId: Credentials.AccessKeyId!,
          secretAccessKey: Credentials.SecretAccessKey!,
          sessionToken: Credentials.SessionToken!
        }
      });
    } else {
      throw new Error(`Unable to assume role with params: ${params}`);
    }
  }

  public async getRoute53SDKForBase(): Promise<Route53> {
    return new Route53({ region: process.env.AWS_REGION! });
  }
}
