import { useState } from 'react';

export interface OverlayImage {
  id: string;
  url: string;
  /** Pixel offset from the top of the terminal viewport. */
  topPx: number;
  leftPx: number;
  maxWidthPx: number;
  /** False when the anchor line has scrolled out of the viewport. */
  visible: boolean;
}

interface Props {
  images: OverlayImage[];
  onRemove: (id: string) => void;
}

/**
 * Renders pasted screenshots as a floating layer over the terminal viewport.
 * Each image is pinned to a buffer line (positions are computed by <Terminal/>)
 * so it scrolls naturally with the surrounding output. Click to enlarge.
 */
export function ImageOverlay({ images, onRemove }: Props) {
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const enlargedUrl = images.find((i) => i.id === enlarged)?.url ?? null;

  return (
    <>
      <div className="image-layer">
        {images.map((img) => (
          <div
            key={img.id}
            className="pasted-image"
            style={{
              top: `${img.topPx}px`,
              left: `${img.leftPx}px`,
              maxWidth: `${img.maxWidthPx}px`,
              display: img.visible ? 'block' : 'none',
            }}
          >
            <img src={img.url} alt="pasted" onClick={() => setEnlarged(img.id)} />
            <button
              className="pasted-image-close"
              title="Remove image"
              onClick={() => onRemove(img.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {enlargedUrl && (
        <div className="image-modal" onClick={() => setEnlarged(null)}>
          <img src={enlargedUrl} alt="pasted (enlarged)" />
        </div>
      )}
    </>
  );
}
