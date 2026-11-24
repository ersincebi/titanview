import { tt } from '../state/i18n';
import type { JSX } from 'solid-js';
import { ICONS } from '../styles/icons';
import { setUi } from '../state/store';
import { Icon } from './Icon';

export function Modal(props: {
  title: string;
  id?: string;
  width?: string;
  className?: string;
  children: JSX.Element;
  onClose?: () => void;
}): JSX.Element {
  const close = () => (props.onClose ? props.onClose() : setUi('modal', null));
  return (
    <div
      id={props.id}
      class="tv-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div class={`tv-modal ${props.className ?? ''}`.trim()} style={props.width ? { width: props.width } : undefined}>
        <div class="tv-modal-header">
          <span>{props.title}</span>
          <button class="icon-btn" aria-label={tt("Kapat")} onClick={close}>
            <Icon svg={ICONS.close} />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}
