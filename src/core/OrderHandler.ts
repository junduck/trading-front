import type { Context } from "./Context.js";

/**
 * Order handler middleware that processes pending actions unconditionally.
 *
 * This is called by the Agent after the middleware chain completes,
 * ensuring actions are executed even if middleware doesn't call next().
 * It validates and executes actions (submit/cancel/amend orders) that were placed
 * by earlier middleware using ctx.submitOrder(), ctx.cancelOrder(), etc.
 *
 * @param ctx - Context containing pending actions
 */
export async function orderHandlerMiddleware(ctx: Context): Promise<void> {
  const pendingActions = ctx.getPendingActions();

  if (pendingActions.length === 0) {
    return;
  }

  // TODO: Action validation
  // - Validate against portfolio constraints (sufficient cash/positions)
  // - Check risk limits (max position size, exposure limits)
  // - Validate parameters for each action type

  // TODO: Action optimization
  // - Merge opposing create orders (e.g., BUY 10 + SELL 5 -> BUY 5)
  // - Combine orders for same symbol/side (BUY 10 + BUY 5 -> BUY 15)
  // - Cancel redundant cancel actions

  for (const pendingAction of pendingActions) {
    const { action } = pendingAction;

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
