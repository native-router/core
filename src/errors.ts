/* eslint-disable max-classes-per-file */

export class NativeRouterError extends Error {}

export class NotFoundError extends NativeRouterError {
  constructor(pathname: string) {
    super(`Can't find the path: ${pathname}`);
  }
}

export class RedirectLoopError extends NativeRouterError {
  constructor(target?: string) {
    super(
      `Redirect loop detected${
        target ? ` after following redirects to: ${target}` : ''
      }`
    );
  }
}
