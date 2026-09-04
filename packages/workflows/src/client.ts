import { Inngest } from 'inngest';

/**
 * The client is intentionally untyped (no `schemas` option): event payloads
 * are validated with Zod at the boundary of each function instead, which
 * keeps the worker bridge free to forward any registered event type.
 */
export const inngest = new Inngest({ id: 'ts-flux' });
