import { TAG_COLOR } from "../Graph/branchColor";
import { TagIcon } from "./icons";

export function TagBadge(props: { name: string }) {
  return (
    <span class="badge tag-badge" style={{ "background-color": `${TAG_COLOR}26`, color: TAG_COLOR, "border-color": TAG_COLOR }}>
      <TagIcon />
      {props.name}
    </span>
  );
}
