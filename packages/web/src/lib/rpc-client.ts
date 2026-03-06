import { makePlotClient } from "@plot/shared";

const client = makePlotClient("/rpc");

export const useRpcClient = () => ({
  getState: () => client.getState(),
  getIssue: (identifier: string) => client.getIssue(identifier),
  triggerRefresh: () => client.triggerRefresh(),
});
