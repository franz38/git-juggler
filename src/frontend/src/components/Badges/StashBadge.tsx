import { tagColor } from "../Graph/branchColor";
import { StashIcon } from "../icons";

export function StashBadge(props: { name: string }) {
  return (
    <span class="badge stash-badge" style={{ "background-color": `${tagColor()}26`, color: tagColor(), "border-color": tagColor() }}>
      <StashIcon />
      {props.name}
    </span>
  );
}
