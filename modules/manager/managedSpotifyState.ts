import type { ManagedSpotifyJob } from "/modules/stdlib/mod.ts";

export function managedJobMessage(job: ManagedSpotifyJob): string | null {
	switch (job.kind) {
		case "idle":
			return null;
		case "complete":
			return "Spotify update finished. Your customization is applied.";
		case "failed":
			return `Spotify update failed: ${job.message}`;
		case "running": {
			const messages = {
				checking: "Checking the selected Spotify package feed.",
				downloading: "Downloading and verifying Spotify.",
				preparing: "Preparing Spotify and applying your customization.",
				activating: "Switching to the prepared installation. Spotify will restart.",
			};
			return messages[job.phase];
		}
	}
}
