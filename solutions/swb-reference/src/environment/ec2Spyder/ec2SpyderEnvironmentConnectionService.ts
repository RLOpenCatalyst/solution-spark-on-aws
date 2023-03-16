/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */


import { AwsService } from '@aws/workbench-core-base';
import {
  EnvironmentConnectionService,
  EnvironmentConnectionLinkPlaceholder
} from '@aws/workbench-core-environments';


export default class EC2SpyderEnvironmentConnectionService implements EnvironmentConnectionService {
  private _envType: string = 'ec2Spyder';
  /**
   * Get credentials for connecting to the environment
   */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  public async getAuthCreds(instanceName: string, context?: any): Promise<any> {
    const authorizedUrl = await this.getSpyderUrl(instanceName, context)
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
  public async getSpyderUrl(instanceId: string, context?: any): Promise<string> {
    const secureConnectionMetadata = JSON.parse(process.env.SECURE_CONNECTION_METADATA!);
    const { partnerDomain } = secureConnectionMetadata;
    const aws = new AwsService({ region: process.env.AWS_REGION!, ddbTableName: process.env.STACK_NAME! });
    const ddbService = aws.helpers.ddb;
    const scanner = ddbService.scan({
      filter: 'instanceId = :val',
      values: { ":val": `${instanceId}` }
    });
    console.log(`Params - ${JSON.stringify(scanner.getParams())}`)
    const dataFromScan = await scanner.execute();
    console.log(`Scan results - ${JSON.stringify(dataFromScan)}`)
    const authorizedUrl = `https://${this._envType}-${dataFromScan!.Items![0].id!}.${partnerDomain}/?authToken=${instanceId}#swb-session`;
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

}
