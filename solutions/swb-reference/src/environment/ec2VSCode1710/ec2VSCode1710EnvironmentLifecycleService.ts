/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { AwsService } from '@aws/workbench-core-base';
import {
  EnvironmentLifecycleService,
  EnvironmentLifecycleHelper,
  EnvironmentService
} from '@aws/workbench-core-environments';
import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';

import { calculateRulePriority, createRoute53Record, deleteRoute53Record } from '../envUtils';

export default class EC2VSCode1710EnvironmentLifecycleService implements EnvironmentLifecycleService {
  public helper: EnvironmentLifecycleHelper;
  public aws: AwsService;
  public envService: EnvironmentService;
  private _envType: string = 'ec2VSCode1710';

  public constructor() {
    this.helper = new EnvironmentLifecycleHelper();
    this.aws = new AwsService({ region: process.env.AWS_REGION!, ddbTableName: process.env.STACK_NAME! });
    this.envService = new EnvironmentService({ TABLE_NAME: process.env.STACK_NAME! });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async launch(envMetadata: any): Promise<{ [id: string]: string }> {
    const cidr = _.find(envMetadata.ETC.params, { key: 'CIDR' })!.value!;
    const instanceSize = _.find(envMetadata.ETC.params, { key: 'InstanceType' })!.value!;
    const amiId = _.find(envMetadata.ETC.params, { key: 'AmiId' })!.value!;
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

    const listenerRulePriority = await calculateRulePriority(envMetadata.id!, this._envType);
    const applicationUrl = `${this._envType}-${envMetadata.id!}.${partnerDomain}`;
    await createRoute53Record(applicationUrl, secureConnectionMetadata);

    const ssmParameters = {
      InstanceName: [`ec2VSCodeinstance-${Date.now()}`],
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
      AmiId: [amiId],
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
    await deleteRoute53Record(applicationUrl, secureConnectionMetadata);
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
}
