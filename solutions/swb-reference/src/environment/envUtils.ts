/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
import { ElasticLoadBalancingV2 } from '@aws-sdk/client-elastic-load-balancing-v2';
import { Route53 } from '@aws-sdk/client-route-53';
import { AwsService } from '@aws/workbench-core-base';
import { EnvironmentService } from '@aws/workbench-core-environments';
import _ from 'lodash';

async function calculateRulePriority(envId: string, envType: string): Promise<string> {
  const envService = new EnvironmentService({ TABLE_NAME: process.env.STACK_NAME! });
  // Get value from env in DDB
  const envDetails = await envService.getEnvironment(envId, true);
  const secureConnectionMetadata = JSON.parse(process.env.SECURE_CONNECTION_METADATA!);
  if (!secureConnectionMetadata) {
    throw new Error('Secure connection metadata not found. Please contact the administrator');
  }
  // Assume hosting account EnvMgmt role
  const elbv2 = await getElbSDKForRole({
    roleArn: envDetails.PROJ.envMgmtRoleArn,
    roleSessionName: `RulePriority-${envType}-${Date.now()}`,
    externalId: envDetails.PROJ.externalId,
    region: process.env.AWS_REGION!
  });

  const params = {
    ListenerArn: secureConnectionMetadata.listenerArn
  };

  const response = await elbv2.describeRules(params);
  const rules = response.Rules!;
  // Returns list of priorities, returns 0 for default rule
  const priorities = _.map(rules, (rule) => {
    return rule.IsDefault ? 0 : _.toInteger(rule.Priority);
  });
  // Adding currently provisioing products to list to avoid priority clash.
  // TBC to a better approach
  const pendingEnvironments = await getPendingEnvironmentsCount();
  const rulePriority = pendingEnvironments + _.max(priorities)! + 1;
  return rulePriority.toString();
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
async function createRoute53Record(applicationUrl: string, secureConnectionMetadata?: any): Promise<void> {
  const { hostedZoneId, albDnsName } = secureConnectionMetadata;
  await changeResourceRecordSets('CREATE', hostedZoneId, applicationUrl, 'CNAME', albDnsName);
  console.log('Created Route53 record');
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
async function deleteRoute53Record(applicationUrl: string, secureConnectionMetadata?: any): Promise<void> {
  try {
    const { hostedZoneId, albDnsName } = secureConnectionMetadata;
    await changeResourceRecordSets('DELETE', hostedZoneId, applicationUrl, 'CNAME', albDnsName);
    console.log('Deleted Route53 record');
  } catch (error) {
    console.error('An error occurred while deleting route53 record:', error.message);
  }
}

async function deleteSSMParameter(envId: string, paramName: string): Promise<void> {
  try {
    const envService = new EnvironmentService({ TABLE_NAME: process.env.STACK_NAME! });
    // Get value from env in DDB
    const envDetails = await envService.getEnvironment(envId, true);
    const region = process.env.AWS_REGION!;
    const awsService = new AwsService({ region });
    const hostingAccountAwsService = await awsService.getAwsServiceForRole({
      roleArn: envDetails.PROJ.envMgmtRoleArn,
      roleSessionName: `Delete-SSM-Parameter-${Date.now()}`,
      externalId: envDetails.PROJ.externalId,
      region
    });
    await hostingAccountAwsService.clients.ssm.deleteParameter({
      Name: paramName
    });
    console.log('Deleted SSM parameter');
  } catch (error) {
    console.error('An error occurred while deleting SSM parameter : ', error.message);
  }
}

async function getPendingEnvironmentsCount(): Promise<number> {
  const envService = new EnvironmentService({ TABLE_NAME: process.env.STACK_NAME! });
  const user = { id: 'SYSTEM', roles: ['Admin'] };
  const filter = { status: 'PENDING' };
  const envDetails = await envService.listEnvironments(user, filter);
  return envDetails!.data!.length;
}

async function changeResourceRecordSets(
  action: string,
  hostedZoneId: string,
  subdomain: string,
  recordType: string,
  recordValue: string
): Promise<void> {
  const route53Client = await getRoute53SDKForBase();
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
            ResourceRecords: [{ Value: recordValue }]
          }
        }
      ]
    }
  };
  await route53Client.changeResourceRecordSets(params);
}

async function getRoute53SDKForBase(): Promise<Route53> {
  return new Route53({ region: process.env.AWS_REGION! });
}

async function getElbSDKForRole(params: {
  roleArn: string;
  roleSessionName: string;
  externalId?: string;
  region: string;
}): Promise<ElasticLoadBalancingV2> {
  const aws = new AwsService({ region: process.env.AWS_REGION!, ddbTableName: process.env.STACK_NAME! });
  const { Credentials } = await aws.clients.sts.assumeRole({
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

export { calculateRulePriority, createRoute53Record, deleteRoute53Record, deleteSSMParameter };
