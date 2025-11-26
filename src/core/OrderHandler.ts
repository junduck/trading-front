import type { Context } from "./Context.js";

/**
 * Process pending order actions from the middleware chain.
 *
 * @param ctx - Context containing pending actions
 */
export async function orderHandler(ctx: Context): Promise<void> {
  const pending = ctx.getPending();

  if (pending.length === 0) {
    return;
  }

  for (const action of pending) {
    if (action.type === "submit") {
      await ctx.tradeProvider.submitOrder(action.order);
    } else if (action.type === "cancel") {
      await ctx.tradeProvider.cancelOrder(action.orderId);
    } else if (action.type === "cancel_all") {
      await ctx.tradeProvider.cancelAllOrders();
    } else if (action.type === "amend") {
      await ctx.tradeProvider.amendOrder(action.orderId, action.updates);
    }
  }
}
