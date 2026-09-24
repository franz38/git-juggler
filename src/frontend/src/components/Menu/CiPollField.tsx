import { DEFAULT_CI_POLL_SECONDS, MAX_CI_POLL_SECONDS, ciPollSeconds, githubConfig, jenkinsConfig, setCiPollSeconds } from "../../state/store";
import { NumberField } from "../inputs/NumberField";

/** How often a running pipeline is re-polled. One value shared by GitHub Actions and Jenkins. */
export function CiPollField() {
  return (
    <NumberField
      label="Pipeline polling interval"
      description={`While a pipeline is running it is re-checked this often (GitHub Actions and Jenkins). Default ${DEFAULT_CI_POLL_SECONDS}.`}
      unit="sec"
      min={1}
      max={MAX_CI_POLL_SECONDS}
      value={ciPollSeconds()}
      disabled={!githubConfig().enabled && !jenkinsConfig().enabled}
      onChange={(value) => setCiPollSeconds(value ?? DEFAULT_CI_POLL_SECONDS)}
    />
  );
}
