import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CardNoteInput } from '../CardNoteInput';

const presets = [
  { id: 'preset-1', note: 'เล่นอันตราย' },
  { id: 'preset-2', note: 'ประท้วงคำตัดสิน' },
];

describe('CardNoteInput', () => {
  it('lets a dropdown preset populate the optional free-text note', () => {
    const onChange = vi.fn();
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CardNoteInput value="" onChange={onChange} presets={presets} />
      );
    });

    const select = renderer!.root.findByType('select');
    act(() => {
      select.props.onChange({ target: { value: 'เล่นอันตราย' } });
    });
    expect(onChange).toHaveBeenCalledWith('เล่นอันตราย');
  });

  it('accepts arbitrary text that is not present in settings', () => {
    const onChange = vi.fn();
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CardNoteInput value="" onChange={onChange} presets={presets} />
      );
    });

    const input = renderer!.root.findByType('input');
    act(() => {
      input.props.onChange({ target: { value: 'เหตุผลเฉพาะเหตุการณ์นี้' } });
    });
    expect(onChange).toHaveBeenCalledWith('เหตุผลเฉพาะเหตุการณ์นี้');
  });

  it('does not require any note value', () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CardNoteInput value="" onChange={() => undefined} presets={presets} />
      );
    });
    expect(renderer!.root.findByType('input').props.value).toBe('');
  });
});
