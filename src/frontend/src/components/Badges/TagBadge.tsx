import { tagColor } from "../Graph/branchColor";
import { TagIcon } from "./icons";

export function TagBadge(props: { name: string; onContextMenu?: (event: MouseEvent) => void }) {
  return (
    <span class="badge tag-badge" style={{ "background-color": `${tagColor()}26`, color: tagColor(), "border-color": tagColor() }} onContextMenu={props.onContextMenu}>
      <TagIcon />
      {props.name}
    </span>
  );
}
