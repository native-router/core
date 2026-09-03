let i = 1;
export function uniqId() {
  return i++;
}

export function noop() {}

export const resolve = /* @__PURE__ */ Promise.resolve.bind(Promise);
export const reject = /* @__PURE__ */ Promise.reject.bind(Promise);

export function createCurrentGuard() {
  let current: number | undefined;
  // Guarded chains still in flight, each holding its reject handle and
  // its cancel-error factory. Registration of a newer chain and cancel()
  // reject them EAGERLY: the underlying resolve may keep running forever
  // (guards can ignore their abort signal), and an awaiter must not hang
  // until that resolve happens to settle.
  const inFlight = new Set<{
    reject: (error: Error) => void;
    discarded: () => Error;
  }>();
  const discardAll = () => {
    inFlight.forEach(({reject: fail, discarded}) => fail(discarded()));
    inFlight.clear();
  };
  return [
    function currentGuard<T>(
      promise: Promise<T>,
      discarded: () => Error
    ): Promise<T> {
      // Registering a new chain supersedes every in-flight one: only one
      // chain can be current, and settled chains have already left the
      // set — so every record here is stale by definition.
      discardAll();
      const cur = uniqId();
      current = cur;
      return new Promise<T>((settle, fail) => {
        const record = {reject: fail, discarded};
        inFlight.add(record);
        promise.then(
          (result) => {
            inFlight.delete(record);
            // A superseded/cancelled chain was already rejected eagerly
            // by discardAll; its late settle is silently dropped.
            if (current === cur) settle(result);
          },
          (err) => {
            inFlight.delete(record);
            if (current === cur) fail(err);
          }
        );
      });
    },
    function cancel() {
      current = undefined;
      discardAll();
    }
  ] as const;
}

export function splitProps<
  T extends object = object,
  K extends keyof T = keyof T
>(obj: T, keys: K[]): [Pick<T, K>, Omit<T, K>] {
  const picked = {} as any;
  const rest = {...obj};
  keys.forEach((key) => {
    picked[key] = rest[key];
    delete rest[key];
  });
  return [picked, rest];
}

export function isString(maybeString: unknown): maybeString is string {
  return typeof maybeString === 'string';
}
