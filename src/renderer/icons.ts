import pencilLine from 'lucide-static/icons/pencil-line.svg?raw';
import libraryBig from 'lucide-static/icons/library-big.svg?raw';
import settingsIcon from 'lucide-static/icons/settings.svg?raw';
import search from 'lucide-static/icons/search.svg?raw';
import cornerDownLeft from 'lucide-static/icons/corner-down-left.svg?raw';
import calendar from 'lucide-static/icons/calendar.svg?raw';
import play from 'lucide-static/icons/play.svg?raw';
import volume2 from 'lucide-static/icons/volume-2.svg?raw';
import sparkles from 'lucide-static/icons/sparkles.svg?raw';
import image from 'lucide-static/icons/image.svg?raw';
import camera from 'lucide-static/icons/camera.svg?raw';
import mic from 'lucide-static/icons/mic.svg?raw';
import circleStop from 'lucide-static/icons/circle-stop.svg?raw';
import link from 'lucide-static/icons/link.svg?raw';
import tag from 'lucide-static/icons/tag.svg?raw';
import loaderCircle from 'lucide-static/icons/loader-circle.svg?raw';
import folderOpen from 'lucide-static/icons/folder-open.svg?raw';
import externalLink from 'lucide-static/icons/external-link.svg?raw';
import penTool from 'lucide-static/icons/pen-tool.svg?raw';
import moveRight from 'lucide-static/icons/move-right.svg?raw';
import square from 'lucide-static/icons/square.svg?raw';
import undo2 from 'lucide-static/icons/undo-2.svg?raw';

const ICONS = {
  'pencil-line': pencilLine,
  'library-big': libraryBig,
  settings: settingsIcon,
  search,
  'corner-down-left': cornerDownLeft,
  calendar,
  play,
  'volume-2': volume2,
  sparkles,
  image,
  camera,
  mic,
  'circle-stop': circleStop,
  link,
  tag,
  'loader-circle': loaderCircle,
  'folder-open': folderOpen,
  'external-link': externalLink,
  'pen-tool': penTool,
  'move-right': moveRight,
  square,
  'undo-2': undo2
} as const;

export type IconName = keyof typeof ICONS;

/** Inline SVG, sized to `size` px, stroke inherits via currentColor. */
export function icon(name: IconName, size = 14): string {
  return ICONS[name]
    .replace(/width="\d+"/, `width="${size}"`)
    .replace(/height="\d+"/, `height="${size}"`);
}
