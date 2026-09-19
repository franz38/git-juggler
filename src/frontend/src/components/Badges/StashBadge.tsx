import { TAG_COLOR } from "../Graph/branchColor";
import { StashIcon } from "./icons";

export function StashBadge(props: { name: string }) {
  return (
    <span class="badge stash-badge" style={{ "background-color": `${TAG_COLOR}26`, color: TAG_COLOR, "border-color": TAG_COLOR }}>
      <StashIcon />
      {props.name}
    </span>
  );
}
