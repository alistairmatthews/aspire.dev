import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createTooltip } = vi.hoisted(() => ({
  createTooltip:
    vi.fn<(element: TooltipElement, options: TooltipOptions) => TooltipElement['_tippy']>(),
}));
vi.mock('tippy.js', () => ({ default: createTooltip }));

interface TooltipOptions {
  content: string;
  onClickOutside: (instance: { hide(): void }) => void;
}

class TooltipElement {
  attributes = new Map<string, string>();
  _tippy?: {
    state: { isDestroyed: boolean };
    hide: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };

  constructor(title: string) {
    this.setAttribute('title', title);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

describe('title tooltip navigation lifecycle', () => {
  let elements: TooltipElement[];
  let document: EventTarget & {
    readyState: string;
    activeElement: TooltipElement | null;
    querySelectorAll: () => TooltipElement[];
  };

  beforeEach(() => {
    vi.resetModules();
    elements = [new TooltipElement('Initial title')];
    document = Object.assign(new EventTarget(), {
      readyState: 'complete',
      activeElement: null as TooltipElement | null,
      querySelectorAll: () => elements,
    });
    vi.stubGlobal('document', document);
    createTooltip.mockReset().mockImplementation((element: TooltipElement) => {
      const instance = {
        state: { isDestroyed: false },
        hide: vi.fn(),
        destroy: vi.fn(() => {
          instance.state.isDestroyed = true;
          delete element._tippy;
        }),
      };
      element._tippy = instance;
      return instance;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('initializes once with existing defaults and removes the native title', async () => {
    await import('@scripts/tooltips');
    expect(createTooltip).toHaveBeenCalledWith(
      elements[0],
      expect.objectContaining({
        content: 'Initial title',
        allowHTML: true,
        theme: 'default',
        maxWidth: 'none',
        placement: 'auto',
        interactive: false,
        delay: [0, 0],
        duration: [0, 0],
        hideOnClick: true,
        animation: 'scale',
      })
    );
    const instance = elements[0]._tippy;
    expect(elements[0].getAttribute('title')).toBe('');
    document.dispatchEvent(new Event('astro:page-load'));
    document.dispatchEvent(new Event('astro:page-load'));
    expect(createTooltip).toHaveBeenCalledOnce();
    expect(elements[0]._tippy).toBe(instance);
  });

  it('waits for DOM readiness and honors per-element placement and interactivity', async () => {
    document.readyState = 'loading';
    elements[0].setAttribute('data-tooltip-placement', 'top');
    elements[0].setAttribute('data-tooltip-interactive', 'true');
    await import('@scripts/tooltips');
    expect(createTooltip).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    document.dispatchEvent(new Event('astro:page-load'));
    expect(createTooltip).toHaveBeenCalledOnce();
    expect(createTooltip).toHaveBeenCalledWith(
      elements[0],
      expect.objectContaining({
        placement: 'top',
        interactive: true,
      })
    );
  });

  it('destroys outgoing instances, restores titles and reinitializes persisted and new nodes', async () => {
    const outgoing = elements[0];
    const persisted = new TooltipElement('Persisted title');
    elements.push(persisted);
    await import('@scripts/tooltips');
    const oldInstances = elements.map((element) => element._tippy!);

    document.dispatchEvent(new Event('astro:before-swap'));
    for (const instance of oldInstances) expect(instance.destroy).toHaveBeenCalledOnce();
    expect(outgoing.getAttribute('title')).toBe('Initial title');
    expect(persisted.getAttribute('title')).toBe('Persisted title');

    elements = [persisted, new TooltipElement('New page title')];
    document.dispatchEvent(new Event('astro:page-load'));
    expect(createTooltip).toHaveBeenCalledTimes(4);
    expect(persisted._tippy).not.toBe(oldInstances[1]);
    expect(createTooltip.mock.calls.slice(2).map(([, options]) => options.content)).toEqual([
      'Persisted title',
      'New page title',
    ]);
    document.dispatchEvent(new Event('astro:page-load'));
    expect(createTooltip).toHaveBeenCalledTimes(4);
    document.dispatchEvent(new Event('astro:before-swap'));
    expect(oldInstances[0].destroy).toHaveBeenCalledOnce();
  });

  it('preserves title edits during teardown and skips empty or externally owned tooltips', async () => {
    const external = new TooltipElement('Other tooltip');
    external._tippy = { state: { isDestroyed: false }, hide: vi.fn(), destroy: vi.fn() };
    elements.push(new TooltipElement(''), external);
    await import('@scripts/tooltips');
    expect(createTooltip).toHaveBeenCalledOnce();
    elements[0].setAttribute('title', 'Updated title');
    document.dispatchEvent(new Event('astro:before-swap'));
    expect(elements[0].getAttribute('title')).toBe('Updated title');
    expect(external._tippy.destroy).not.toHaveBeenCalled();
  });

  it('retains Escape and outside-click dismissal', async () => {
    await import('@scripts/tooltips');
    document.activeElement = elements[0];
    const instance = elements[0]._tippy!;
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    createTooltip.mock.calls[0][1].onClickOutside(instance);
    expect(instance.hide).toHaveBeenCalledTimes(2);
  });
});
