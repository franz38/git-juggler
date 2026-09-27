import { colorForBranch } from "../Graph/branchColor";
import { BranchIcon } from "../icons";

export function BranchBadge(props: { name: string; remote?: boolean; onContextMenu?: (event: MouseEvent) => void }) {
  const color = () => colorForBranch(props.name);
  return (
    <span class="badge branch-badge" classList={{ remote: props.remote }} style={{ "background-color": `${color()}26`, color: color(), "border-color": color() }} onContextMenu={props.onContextMenu}>
      <BranchIcon />
      {props.name}
    </span>
  );
}
