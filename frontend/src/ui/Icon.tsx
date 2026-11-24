import type { JSX } from 'solid-js';

/** SVG ikon dizgisini DOM'a basar (ikonlar sabit, güvenilir kaynak: styles/icons.ts). */
export function Icon(props: { svg: string }): JSX.Element {
  return <span style={{ display: 'contents' }} innerHTML={props.svg} />;
}
