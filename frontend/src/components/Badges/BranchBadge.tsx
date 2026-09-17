import { colorForBranch } from "../Graph/branchColor";
import { BranchIcon } from "./icons";

export function BranchBadge(props: { name: string }) {
  const color = () => colorForBranch(props.name);
  return (
    <span class="badge branch-badge" style={{ "background-color": `${color()}26`, color: color(), "border-color": color() }}>
      <BranchIcon />
      {props.name}
    </span>
  );
}
