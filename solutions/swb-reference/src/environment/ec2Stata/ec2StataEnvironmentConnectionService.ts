/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { AwsService } from '@aws/workbench-core-base';
import {
  EnvironmentConnectionService,
  EnvironmentConnectionLinkPlaceholder
} from '@aws/workbench-core-environments';

export default class EC2StataEnvironmentConnectionService implements EnvironmentConnectionService {
  private _envType: string = 'ec2Stata';
  /**
   * Get credentials for connecting to the environment
   */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  public async getAuthCreds(instanceName: string, context?: any): Promise<any> {
    const authorizedUrl = await this.getStataUrl(instanceName, context);
    return { url: authorizedUrl };
  }

  /**
   * Instructions for connecting to the workspace that can be shown verbatim in the UI
   */
  public getConnectionInstruction(): Promise<string> {
    // "url" is the key of the response returned by the method `getAuthCreds`
    const link: EnvironmentConnectionLinkPlaceholder = {
      type: 'link',
      hrefKey: 'url',
      text: 'Spyder IDE URL'
    };
    return Promise.resolve(`To access Spyder, open #${JSON.stringify(link)}`);
  }

  /**
   * Get Spyder connection URL by reading public DNS using SDK.
   */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  public async getStataUrl(instanceId: string, context?: any): Promise<string> {
    const secureConnectionMetadata = JSON.parse(process.env.SECURE_CONNECTION_METADATA!);
    const { partnerDomain } = secureConnectionMetadata;
    const envId = context.envId;
    const data = await this.getStataToken(instanceId, context);
    const { auth_token, session_id } = JSON.parse(data);
    const authorizedUrl = `https://${this._envType}-${envId}.${partnerDomain}/?authToken=${auth_token}#${session_id}`;
    console.log(`URL - ${authorizedUrl}`);
    // const region = process.env.AWS_REGION!;
    // const awsService = new AwsService({ region });
    // const hostingAccountAwsService = await awsService.getAwsServiceForRole({
    //   roleArn: context.roleArn,
    //   roleSessionName: `SpyderConnect-${Date.now()}`,
    //   externalId: context.externalId,
    //   region
    // });
    // const response = await hostingAccountAwsService.clients.ec2.describeInstances({
    //   InstanceIds: [instanceId]
    // });
    // const instanceDns = response.Reservations![0].Instances![0].PublicDnsName!;
    // const authorizedUrl = `https://${instanceDns}:8443/?authToken=${instanceId}#swb-session`;
    return authorizedUrl;
  }

  /**
   * Get VSCode access key from SSM parameter.
   */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  public async getStataToken(instanceId: string, context?: any): Promise<string> {
    const region = process.env.AWS_REGION!;
    const awsService = new AwsService({ region });
    const hostingAccountAwsService = await awsService.getAwsServiceForRole({
      roleArn: context.roleArn,
      roleSessionName: `SpyderConnect-${Date.now()}`,
      externalId: context.externalId,
      region
    });

    const response = await hostingAccountAwsService.clients.ssm.getParameter({
      Name: `/stata/access-token/sc-environments/ec2-instance/${instanceId}`,
      WithDecryption: true
    });
    return response.Parameter!.Value!;
  }
}
