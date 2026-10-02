import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { usePresence } from '../usePresence';

/*
 * Every Dialog / BottomSheet (sign-out confirmation included) opens through
 * usePresence: when `visible` turns true the overlay must be shown in the same
 * commit, and it must stay mounted only for the exit animation after closing.
 */

let shown: boolean[] = [];

function Probe({ visible }: { visible: boolean }) {
  shown.push(usePresence(visible));
  return null;
}

describe('usePresence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    shown = [];
  });
  afterEach(() => jest.useRealTimers());

  const latest = () => shown[shown.length - 1];

  it('opens as soon as it becomes visible, even long after mounting closed', async () => {
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(<Probe visible={false} />);
    });
    // The closed overlay's exit timer has long fired before anyone opens it.
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(latest()).toBe(false);

    await act(async () => {
      root.update(<Probe visible />);
    });
    expect(latest()).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(latest()).toBe(true);
  });

  it('stays mounted for the exit animation, then unmounts', async () => {
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(<Probe visible />);
    });
    await act(async () => {
      root.update(<Probe visible={false} />);
    });
    expect(latest()).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(latest()).toBe(false);
  });

  it('reopens while the exit animation is still running', async () => {
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(<Probe visible />);
    });
    await act(async () => {
      root.update(<Probe visible={false} />);
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
      root.update(<Probe visible />);
    });
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(latest()).toBe(true);
  });
});
