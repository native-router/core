import Should from 'should';
import sinon from 'sinon';
import {createMemoryHistory} from 'history';
import {
  create,
  match,
  resolveTo,
  commit,
  commitReplace,
  navigate,
  refresh,
  go,
  forward,
  back,
  createHref,
  cancel,
  initHistoryStack,
  listen
} from '../src/router';

describe('Router', () => {
  describe('match', () => {
    it('should match a path', () => {
      const history = createMemoryHistory();
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        () => Promise.resolve(null)
      );
      const matched = match(router, '/bar');
      matched!.length.should.equal(2);
      matched![1].path.should.equal('/bar');
    });
  });

  describe('resolveTo', () => {
    it('should resolve a path', () => {
      const history = createMemoryHistory();
      const router = create(
        {path: '', children: [{path: '/foo'}, {path: '/bar'}]},
        history,
        (matched) => Promise.resolve(matched.at(-1)!.path)
      );
      return resolveTo(router, '/bar').then((path) => {
        path.should.be.equal('/bar');
      });
    });
  });

  describe('commit', () => {
    it('should commit the resolve task and push history', () => {
      // Test code here
    });
  });

  describe('commitReplace', () => {
    it('should commit the resolve task and replace history', () => {
      // Test code here
    });
  });

  describe('navigate', () => {
    it('should navigate to a new path', () => {
      // Test code here
    });
  });

  describe('refresh', () => {
    it('should refresh the page', () => {
      // Test code here
    });
  });

  describe('go', () => {
    it('should navigate in history stack', () => {
      // Test code here
    });
  });

  describe('forward', () => {
    it('should forward in history stack', () => {
      // Test code here
    });
  });

  describe('back', () => {
    it('should go back in history stack', () => {
      // Test code here
    });
  });

  describe('createHref', () => {
    it('should create href of a route path', () => {
      // Test code here
    });
  });

  describe('cancel', () => {
    it('should cancel the current navigate', () => {
      // Test code here
    });
  });

  describe('initHistoryStack', () => {
    it('should initialize the history stack', () => {
      // Test code here
    });
  });

  describe('listen', () => {
    it('should listen to history change', () => {
      // Test code here
    });
  });
});
