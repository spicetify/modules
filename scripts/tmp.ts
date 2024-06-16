/************************************************
				MediaKeySystem configuration
************************************************/

const _configs = [
	{
		"label": "video-sw-decode",
		"initDataTypes": [
			"cenc",
		],
		"audioCapabilities": [
			{
				"contentType": 'audio/mp4; codecs="flac"',
				"robustness": "SW_SECURE_CRYPTO",
			},
			{
				"contentType": 'audio/mp4; codecs="mp4a.40.2"',
				"robustness": "SW_SECURE_CRYPTO",
			},
			{
				"contentType": 'audio/webm; codecs="opus"',
				"robustness": "SW_SECURE_CRYPTO",
			},
		],
		"videoCapabilities": [
			{
				"contentType": 'video/mp4; codecs="avc1.64002a"',
				"robustness": "SW_SECURE_DECODE",
			},
			{
				"contentType": 'video/mp4; codecs="avc1.4d402a"',
				"robustness": "SW_SECURE_DECODE",
			},
			{
				"contentType": 'video/mp4; codecs="avc1.4d401f"',
				"robustness": "SW_SECURE_DECODE",
			},
			{
				"contentType": 'video/webm; codecs="vp9"',
				"robustness": "SW_SECURE_DECODE",
			},
			{
				"contentType": 'video/webm; codecs="vp8"',
				"robustness": "SW_SECURE_DECODE",
			},
		],
		"distinctiveIdentifier": "optional",
		"persistentState": "optional",
		"sessionTypes": [
			"temporary",
		],
	},
	{
		"label": "video-sw-crypto",
		"initDataTypes": [
			"cenc",
		],
		"audioCapabilities": [
			{
				"contentType": 'audio/mp4; codecs="flac"',
				"robustness": "SW_SECURE_CRYPTO",
			},
			{
				"contentType": 'audio/mp4; codecs="mp4a.40.2"',
				"robustness": "SW_SECURE_CRYPTO",
			},
			{
				"contentType": 'audio/webm; codecs="opus"',
				"robustness": "SW_SECURE_CRYPTO",
			},
		],
		"videoCapabilities": [
			{
				"contentType": 'video/mp4; codecs="avc1.64002a"',
				"robustness": "SW_SECURE_CRYPTO",
			},
			{
				"contentType": 'video/mp4; codecs="avc1.4d402a"',
				"robustness": "SW_SECURE_CRYPTO",
			},
			{
				"contentType": 'video/mp4; codecs="avc1.4d401f"',
				"robustness": "SW_SECURE_CRYPTO",
			},
			{
				"contentType": 'video/webm; codecs="vp9"',
				"robustness": "SW_SECURE_CRYPTO",
			},
			{
				"contentType": 'video/webm; codecs="vp8"',
				"robustness": "SW_SECURE_CRYPTO",
			},
		],
		"distinctiveIdentifier": "optional",
		"persistentState": "optional",
		"sessionTypes": [
			"temporary",
		],
	},
	{
		"label": "audio-flac-sw-crypto",
		"initDataTypes": [
			"cenc",
		],
		"audioCapabilities": [
			{
				"contentType": 'audio/mp4; codecs="flac"',
				"robustness": "SW_SECURE_CRYPTO",
			},
			{
				"contentType": 'audio/mp4; codecs="mp4a.40.2"',
				"robustness": "SW_SECURE_CRYPTO",
			},
		],
		"videoCapabilities": [],
		"distinctiveIdentifier": "optional",
		"persistentState": "optional",
		"sessionTypes": [
			"temporary",
		],
	},
	{
		"label": "audio-sw-crypto",
		"initDataTypes": [
			"cenc",
		],
		"audioCapabilities": [
			{
				"contentType": 'audio/mp4; codecs="mp4a.40.2"',
				"robustness": "SW_SECURE_CRYPTO",
			},
		],
		"videoCapabilities": [],
		"distinctiveIdentifier": "optional",
		"persistentState": "optional",
		"sessionTypes": [
			"temporary",
		],
	},
];

const mediaKeySystemAccess = await navigator.requestMediaKeySystemAccess("com.widevine.alpha", _configs as any);

const mediaKeySystemConfiguration = mediaKeySystemAccess.getConfiguration();

function _parseCapabilities(cs: MediaKeySystemMediaCapability[]) {
	if (!cs) {
		return [];
	}
	const n = [];
	for (const c of cs) {
		if (!c?.contentType) {
			continue;
		}
		const [, e, o] = c.contentType.match(/([^;]+)(?:;\s?codecs="(.*)")?/) ?? [];
		e && n.push({
			contentType: c.contentType,
			mimeType: e,
			codec: o ?? "",
		});
	}
	return n;
}

const _configuration = {
	keySystem: "com.widevine.alpha",
	keySystemImpl: "native",
	audioFormats: _parseCapabilities(mediaKeySystemConfiguration.audioCapabilities!),
	videoFormats: _parseCapabilities(mediaKeySystemConfiguration.videoCapabilities!),
};

const _keySystemSettings = {
	"commonName": "widevine",
	"licenseServer": "https://@webgate/widevine-license",
	"withCertificate": true,
	"pssh_field": {
		"audio": "pssh_widevine",
		"video": "encryption_data",
	},
};

const getServerCertificate = (() => {
	let _certificate = {
		expiry: 0,
		contents: new ArrayBuffer(0),
	};

	return async function () {
		if (_certificate.expiry > Date.now()) {
			return _certificate;
		}

		const cert = await fetch("https://spclient.wg.spotify.com/widevine-license/v1/application-certificate");

		let n = 3600;

		let cacheControl = cert.headers.get("cache-control");
		if (cacheControl) {
			const i = cacheControl.match(/(?:^|,|\s)max-age=(\d+)(?:,|$)/);
			if (i && i[1]) {
				n = 1000 * parseInt(i[1], 10);
			}
		}

		return {
			expiry: Date.now() + n - 600,
			contents: await cert.arrayBuffer(),
		};
	};
})();

/************************************************
				Segments
************************************************/

interface Segment {
	timeStart: number;
	timeEnd: number;
	byteRanges: {
		audio: {
			start: number;
			end: number;
		};
	};
}

enum FileFormats {
	MP3_256 = 3,
	MP3_320 = 4,
	MP3_160 = 5,
	MP3_96 = 6,
	MP4_128 = 10,
	MP4_256 = 11,
	MP4_128_DUAL = 12,
	MP4_256_DUAL = 13,
	MP4_128_CBCS = 14,
	MP4_256_CBCS = 15,
	MP4_FLAC = 17,
}

const MimeTypes = {
	3: "audio/mp3",
	4: "audio/mp3",
	5: "audio/mp3",
	6: "audio/mp3",
	10: 'audio/mp4; codecs="mp4a.40.2"',
	11: 'audio/mp4; codecs="mp4a.40.2"',
	12: 'audio/mp4; codecs="mp4a.40.2"',
	13: 'audio/mp4; codecs="mp4a.40.2"',
	14: 'audio/mp4; codecs="mp4a.40.2"',
	15: 'audio/mp4; codecs="mp4a.40.2"',
	17: 'audio/mp4; codecs="flac"',
} as const;

type Manifest = any;

class Segmenter {
	initSegment!: Segment;
	segmentLength = 0;
	contentSegments = new Array<Segment>();
	duration = 0;
	disableCache = false;
	licensed = false;
	constructor(private manifest: Manifest) {
		if ("segments" in manifest) {
			this.calculateSegments();
		} else if ("references" in manifest) {
			this.calculateSegmentsV1();
		}
	}

	private calculateSegments() {
		let scaledDuration = 0;
		let t_start = 0;
		let b_start = this.manifest.offset;

		this.initSegment = {
			timeStart: 0,
			timeEnd: 0,
			byteRanges: {
				audio: {
					start: 0,
					end: b_start - 1,
				},
			},
		};

		const segments = new Array(this.manifest.segments.length);

		for (let i = 0; i < this.manifest.segments.length; i++) {
			const segment = this.manifest.segments[i];
			if (!segment?.length) {
				continue;
			}
			const [size, duration] = segment;
			const t_duration = duration / this.manifest.timescale;
			const t_end = t_start + t_duration;
			const b_end = b_start + (size - 1);
			segments[i] = {
				timeStart: t_start,
				timeEnd: t_end,
				byteRanges: {
					audio: {
						start: b_start,
						end: b_end,
					},
				},
			};
			scaledDuration += duration;
			t_start = t_end;
			b_start = b_end + 1;

			this.segmentLength = Math.max(this.segmentLength, Math.floor(t_duration));
		}

		segments[segments.length - 1].isFinal = true;

		this.contentSegments = segments;
		this.duration = scaledDuration / this.manifest.timescale;
	}

	private calculateSegmentsV1() {
		let scaledDuration = 0;
		let t_start = 0;
		let b_start = this.manifest.offset;

		this.initSegment = {
			timeStart: 0,
			timeEnd: 0,
			byteRanges: {
				audio: {
					start: 0,
					end: b_start - 1,
				},
			},
		};

		const segments = new Array(this.manifest.references.length);

		for (let i = 0; i < this.manifest.references.length; i++) {
			const reference = this.manifest.references[i];
			if (!reference) {
				continue;
			}
			const t_duration = reference.duration / this.manifest.timescale;
			const t_end = t_start + t_duration;
			const b_end = b_start + (reference.size - 1);
			segments[i] = {
				timeStart: t_start,
				timeEnd: t_end,
				byteRanges: {
					audio: {
						start: b_start,
						end: b_end,
					},
				},
			};
			scaledDuration += reference.duration;
			t_start = t_end;
			b_start = b_end + 1;

			this.segmentLength = Math.max(this.segmentLength, Math.floor(t_duration));
		}

		segments[segments.length - 1].isFinal = true;

		this.contentSegments = segments;
		this.duration = scaledDuration / this.manifest.timescale;
	}

	async parseSegmentResponse(res: Response, segment: Segment) {
		const buffer = await res.arrayBuffer();
		if (!buffer) {
			return null;
		}

		const { start, end } = segment.byteRanges.audio;

		if (buffer.byteLength !== end + 1 - start) {
			return null;
		}

		const bufferSet = {
			byteStart: start,
			byteEnd: end,
			buffer,
		};

		return bufferSet;
	}

	getSegmentForTime(time: number) {
		if (!this.contentSegments.length) {
			return null;
		}
		if (0 === time || .01 === time) {
			return this.contentSegments[0] ?? null;
		}
		for (const i of this.contentSegments) {
			if (i.timeStart <= time && i.timeEnd >= time) {
				return i;
			}
		}
		return null;
	}

	getSegmentAfterTime(time: number) {
		if (!this.contentSegments.length) {
			return null;
		}
		if (0 === time || .01 === time) {
			return this.contentSegments[1] ?? null;
		}
		for (const i of this.contentSegments) {
			if (i.timeStart > time) {
				return i;
			}
		}
		return null;
	}

	getSegmentsForRange(start: number, end = Number.POSITIVE_INFINITY) {
		const i = [];
		if (this.contentSegments.length) {
			for (const s of this.contentSegments) {
				s.timeStart <= end && s.timeEnd >= start && i.push(s);
			}
		}
		return i;
	}
	getFinalSegment() {
		return this.contentSegments?.at(-1) ?? null;
	}

	getBufferSetForSegment(segment: Segment, url: string) {
		const i = segment.byteRanges.audio;

		const bufferSet = fetch(url, { headers: { Range: `bytes=${i.start}-${i.end}` } }).then((e) =>
			this.parseSegmentResponse(e, segment)
		);

		return bufferSet;
	}
}

/************************************************
				Utility queries
************************************************/

const base62ToHex = (s: string) => {
	const BASE_62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
	const n = s.split("").reduce((n, c) => n * 62n + BigInt(BASE_62.indexOf(c)), 0n);
	return n.toString(16);
};

const registryMap: Map<symbol, any> = (globalThis as any).registry._map;
const RequestBuilder = registryMap.get(Symbol.for("RequestBuilder")).instance;
const PlayerAPI = registryMap.get(Symbol.for("PlayerAPI")).instance;

function getTrackMeta(trackHex: string) {
	return RequestBuilder.build()
		.withHost("https://spclient.wg.spotify.com/metadata/4")
		.withPath("/track/" + trackHex)
		.withResponseType("json")
		.send();
}

function getManifest(fileId: string): Promise<Manifest> {
	return RequestBuilder.build()
		.withHost("https://seektables.scdn.co")
		.withPath("/seektable/" + fileId + ".json")
		.withResponseType("json")
		.withoutMarket()
		.withoutAuthorization()
		.withoutGlobalHeaders()
		.send();
}

function getCDNURLS(fileId: string) {
	return RequestBuilder.build()
		.withHost("https://gew1-spclient.spotify.com")
		.withPath("/storage-resolve/files/audio/interactive/" + fileId)
		.withQueryParameters({
			version: 10000000,
			product: 9,
			platform: 39,
			alt: "json",
		})
		.withResponseType("json")
		.send();
}

function decodePSSH(b64: string) {
	const s = atob(b64);
	const u8a = new Uint8Array(s.length);
	for (let i = 0, l = s.length; i < l; i++) {
		u8a[i] = s.charCodeAt(i);
	}
	return u8a;
}

function parseManifest(manifest: Manifest) {
	const pssh = decodePSSH(manifest[_keySystemSettings.pssh_field.audio] ?? manifest["pssh"]);
	const protection = manifest.protection ?? "cenc";
	const segmenter = new Segmenter(manifest);

	return { pssh, protection, segmenter };
}

/************************************************
				License
************************************************/

const requestLicense = async (pssh: ArrayBufferLike, protection: string, mediaKeys: MediaKeys) => {
	const r = Promise.withResolvers<void>();

	const mediaKeySession = mediaKeys.createSession();

	mediaKeySession.addEventListener("message", async (e) => {
		if (!e.message) {
			return;
		}

		const license = await RequestBuilder.build()
			.withHost("https://gew1-spclient.spotify.com")
			.withPath("/widevine-license/v1/audio/license")
			.withResponseType("arraybuffer")
			.withMethod("POST")
			.withBody(e.message)
			.withoutMarket()
			.send();

		if (license.status === 200 && license.body) {
			console.log("updating mediaKeySession");
			await mediaKeySession.update(license.body);
		}
	});

	mediaKeySession.addEventListener("keystatuseschange", () => {
		console.log("keystatus change");
		r.resolve();
	});

	await mediaKeySession.generateRequest(protection, pssh);

	return r.promise;
};

/************************************************
				Loading audio
************************************************/

async function createPlayer() {
	const player = document.createElement("video");
	player.playsInline = true;

	await player.setMediaKeys(await mediaKeySystemAccess.createMediaKeys());
	await player.mediaKeys!.setServerCertificate((await getServerCertificate()).contents);

	return player;
}

const loadTrackIntoPlayer = (player: HTMLMediaElement) =>
	async function (trackUri: string) {
		const mediaSource = new MediaSource();
		const sourceBuffer = Promise.withResolvers<SourceBuffer>();
		mediaSource.addEventListener("sourceopen", async () => {
			const mimeType = MimeTypes[FileFormats.MP4_256];
			if (mediaSource.sourceBuffers.length === 0) {
				const sb = mediaSource.addSourceBuffer(mimeType);
				sourceBuffer.resolve(sb);
			}
			await requestLicense(pssh.buffer, protection, player.mediaKeys!);
		});

		const trackId = trackUri.slice("spotify:track:".length);
		const trackHex = base62ToHex(trackId);
		const fileId = await getTrackMeta(trackHex).then((res: any) =>
			res.body.file.find((f: any) => f.format === FileFormats[FileFormats.MP4_256]).file_id
		);
		const cdnUrl = await getCDNURLS(fileId).then((res: any) => res.body.cdnurl[0]);

		const { body: manifest } = await getManifest(fileId);
		const { pssh, protection, segmenter } = parseManifest(manifest);

		player.src = URL.createObjectURL(mediaSource);

		sourceBuffer.promise.then(async (sb) => {
			const buffers = [];

			const initBufferSet = await segmenter.getBufferSetForSegment(segmenter.initSegment, cdnUrl);
			buffers.push(initBufferSet!);

			for (const segment of segmenter.contentSegments) {
				const bufferSet = await segmenter.getBufferSetForSegment(segment, cdnUrl);
				buffers.push(bufferSet!);
			}

			console.log(buffers);
			for (const buffer of buffers) {
				if (sb.updating) {
					await new Promise<void>((r) => {
						const listener = () => {
							sb.removeEventListener("updateend", listener);
							r();
						};
						sb.addEventListener("updateend", listener);
					});
				}

				sb.appendBuffer(buffer.buffer);
			}
		});
	};

type PlayerState = any;

async function synchronizePlayer(player: HTMLMediaElement, offsetMs = 0) {
	const loadTrack = loadTrackIntoPlayer(player);

	const onSongChanged = async (state: PlayerState) => {
		player.pause();
		console.log(`song changed, loading next song "${state.item.uri}"`);
		await loadTrack(state.item.uri);
		player.play();
	};

	const onPlaybackChanged = (state: PlayerState) => {
		if (state.isPaused) {
			console.log("pausing internal player");
			player.pause();
		} else {
			console.log("resuming internal player");
			player.play();
		}
	};

	const resync = (msg: string, epsilon: number) => (playerState: any) => {
		const currentTime = (getSongPositionMs(playerState) + offsetMs) / 1000;
		const delta = player.currentTime - currentTime;
		if (Math.abs(delta) <= epsilon) {
			msg && console.log(msg, delta);
			player.currentTime = currentTime;
		}
	};

	const forceResync = resync("mitigating currentTime playback delta: %s", Number.MAX_VALUE);

	let state: PlayerState = {};
	const onPlayerUpdate = ({ data: _state }: { data: PlayerState }) => {
		const oldUri = state.item?.uri;
		const newUri = _state.item?.uri;
		if ((oldUri || newUri) && newUri !== oldUri) {
			onSongChanged(_state);
		}

		if (_state.isPaused !== state.isPaused) {
			onPlaybackChanged(_state);
		}

		forceResync(_state);

		state = _state;
	};

	PlayerAPI.getEvents().addListener("update", onPlayerUpdate);

	return {
		cancel: () => PlayerAPI.getEvents().removeListener("update", onPlayerUpdate),
		resync,
	};
}

const getSongPositionMs = (state = PlayerAPI.getState()) => {
	if (state === null) return 0;
	const { positionAsOfTimestamp, timestamp, duration, speed, hasContext, isPaused, isBuffering } = state;
	if (!positionAsOfTimestamp || !duration) return 0;
	if (!hasContext || isPaused || isBuffering) return positionAsOfTimestamp;
	const scaledTimeSinceTimestamp = (Date.now() - timestamp) * (speed ?? 0);
	return Math.min(positionAsOfTimestamp + scaledTimeSinceTimestamp, duration);
};

/************************************************
				Loading visualizer
************************************************/

function aWeighting(f: number) {
	const f2 = f * f;
	return 1.2588966 * 148840000 * f2 * f2 /
		((f2 + 424.36) * Math.sqrt((f2 + 11599.29) * (f2 + 544496.41)) * (f2 + 148840000));
}

//高斯公式
function gauss(x: number, sigma = 1, mu = 0) {
	return Math.exp(-((x - mu) ** 2 / (2 * sigma ** 2)));
}

interface SoundProcessorOptions {
	filterParams?: { mu?: number; sigma?: number; radius?: number };
	sampleRate: number;
	fftSize: number;
	endFrequency?: number;
	startFrequency?: number;
	outBandsQty: number;
	tWeight?: boolean;
	aWeight?: boolean;
}
class SoundProcessor {
	sampleRate: number;
	bandsQty: number;
	outBandsQty: number;
	bandwidth: number;
	startFreq: number;
	endFreq: number;
	tWeight: boolean;
	aWeight: boolean;
	filterParams?: {
		mu: number;
		sigma: number;
		filterRadius: number;
	};
	aWeights = new Array<number>();
	bands = new Array<{ l: number; h: number }>();
	gKernel = new Array<number>();
	historyLimit = 5;
	history = new Array<Uint8Array>();
	gKernelSum?: number;
	filterRadius?: number;
	constructor(options: SoundProcessorOptions) {
		this.sampleRate = options.sampleRate;
		this.bandsQty = Math.floor(options.fftSize / 2);
		this.outBandsQty = options.outBandsQty;
		this.bandwidth = options.sampleRate / options.fftSize;
		this.startFreq = options.startFrequency ?? 0;
		this.endFreq = options.endFrequency ?? 10000;
		this.tWeight = options.tWeight ?? false;
		this.aWeight = options.aWeight ?? true;

		if (options.filterParams) {
			// Default standard normal distribution: N(0, 1)
			this.filterParams = {
				mu: options.filterParams.mu ?? 0,
				sigma: options.filterParams.sigma ?? 1,
				filterRadius: Math.floor(options.filterParams.radius ?? Math.E),
			};
		}

		this.initWeights();
		this.initBands();
		this.initGaussKernel();

		this.process = this.process.bind(this);
	}

	initWeights() {
		for (let i = 0; i < this.bandsQty; i++) {
			this.aWeights.push(aWeighting(i * this.bandwidth));
		}
	}

	initBands() {
		// Determine the frequency multiplication number based on the starting and ending spectrum and the number of frequency bands: N
		// fe = 2^(1/N)*fs ==> n = 1/N = log2(fe/fs) / bandsQty
		const _1_N = Math.log2(this.endFreq / this.startFreq) / this.outBandsQty;
		const n = Math.pow(2, _1_N); // n = 2^(1/N)

		const band = {
			l: Math.max(this.startFreq, 0),
			h: 0,
		};

		for (let i = 0; i < this.outBandsQty; i++) {
			// The upper frequency point of the frequency band is 2^n times the lower frequency point
			const h = band.l * n;
			band.h = Math.min(h, this.endFreq);

			this.bands.push({ ...band });
			band.l = h;
		}
	}

	initGaussKernel() {
		if (!this.filterParams) {
			return;
		}

		const { mu, sigma, filterRadius } = this.filterParams;
		this.filterRadius = filterRadius;

		for (let i = filterRadius; i >= 0; i--) {
			this.gKernel.push(gauss(-i, sigma, mu));
		}
		for (let i = filterRadius - 1; i >= 0; i--) {
			this.gKernel.push(gauss(this.gKernel[i]));
		}

		this.gKernelSum = this.gKernel.reduce((s, k) => s + k, 0);
	}

	filter(frequencies: Uint8Array) {
		if (!this.filterRadius || !this.gKernelSum) {
			return;
		}

		for (let i = 0; i < frequencies.length; i++) {
			let count = 0;
			for (let j = i - this.filterRadius; j < i + this.filterRadius; j++) {
				const value = frequencies[j] !== undefined ? frequencies[j] : 0;
				count += value * this.gKernel[j - i + this.filterRadius];
			}

			frequencies[i] = count / this.gKernelSum;
		}
	}

	aWeighting(frequencies: Uint8Array) {
		for (let i = 0; i < frequencies.length; i++) {
			if (this.aWeights[i] !== undefined) {
				frequencies[i] *= this.aWeights[i];
			}
		}
	}

	divide(frequencies: Uint8Array) {
		return this.bands.map((band) => {
			const si = Math.floor(band.l / this.bandwidth);
			const ei = Math.min(Math.floor(band.h / this.bandwidth), frequencies.length - 1) + 1;
			const count = frequencies.slice(si, ei).reduce((s, f) => s + f ** 2, 0);
			return Math.sqrt(count / (ei - si));
		});
	}

	timeWeighting(frequencies: Uint8Array) {
		if (this.history.length < 5) {
			this.history.push(frequencies.slice(0));
		} else {
			this.history.pop();
			this.history.unshift(frequencies.slice(0));
			for (let i = 0; i < frequencies.length; i++) {
				let count = 0;
				for (let j = 0; j < this.historyLimit; j++) {
					count += this.history[j][i];
				}
				frequencies[i] = count / this.historyLimit;
			}
		}
	}

	process(frequencies: Uint8Array) {
		// 1. filter
		if (this.filterParams) {
			this.filter(frequencies);
		}

		// 2. time weight
		if (this.tWeight) {
			this.timeWeighting(frequencies);
		}

		// 3. a weight
		if (this.aWeight) {
			this.aWeighting(frequencies);
		}

		// 4. spectrum divide
		return this.divide(frequencies);
	}
}

const FFT_SIZE = 1024;
const FREQ_START = 150;
const FREQ_END = 4500;
const BAR_COUNT = 81;
const BAR_GAP = 5;

class PlayerW {
	AC: AudioContext;
	VC: VisualCanvas;
	analyser: AnalyserNode;
	audio?: HTMLMediaElement;
	SP?: SoundProcessor;
	rendering = false;
	onDrawPre?: (self: PlayerW) => void;
	constructor(canvas: HTMLCanvasElement) {
		this.AC = new AudioContext();

		this.analyser = this.AC.createAnalyser();
		this.analyser.fftSize = FFT_SIZE;

		this.VC = new VisualCanvas(canvas);

		this.drawRecur = this.drawRecur.bind(this);
		this.setAudio = this.setAudio.bind(this);

		this.onPlay = this.onPlay.bind(this);
		this.onPause = this.onPause.bind(this);
	}

	setAudio(audio: HTMLMediaElement) {
		this.audio = audio;
		this.audio.source ??= this.AC.createMediaElementSource(this.audio);

		this.audio.source.connect(this.analyser);
		// this.analyser.connect(this.AC.destination);

		audio.addEventListener("play", this.onPlay);

		audio.addEventListener("pause", this.onPause);

		this.SP = new SoundProcessor({
			filterParams: {
				sigma: 1,
				radius: 2,
			},
			sampleRate: this.AC.sampleRate,
			fftSize: FFT_SIZE,
			endFrequency: FREQ_END,
			startFrequency: FREQ_START,
			outBandsQty: BAR_COUNT,
			tWeight: true,
			aWeight: true,
		});
	}

	async onPlay() {
		await this.AC.resume();
		console.log("internal playback resumed, starting draw loop");
		this.rendering = true;
		this.drawRecur();
	}

	async onPause() {
		console.log("internal playback paused, breaking draw loop");
		this.rendering = false;
	}

	drawRecur() {
		if (!this.rendering) {
			return;
		}

		this.onDrawPre?.(this);

		this.VC.update(this.getFreqs());
		requestAnimationFrame(this.drawRecur);
	}

	getFreqs() {
		const array = new Uint8Array(this.analyser.frequencyBinCount);
		this.analyser.getByteFrequencyData(array);
		return this.SP!.process(array);
	}
}

class VisualCanvas {
	ratio: number;
	ctx: CanvasRenderingContext2D;
	bars = new Array<Bar>();
	constructor(public canvas: HTMLCanvasElement) {
		const canvasStyle = getComputedStyle(canvas);
		this.ratio = devicePixelRatio ?? 1;
		canvas.width = parseFloat(canvasStyle.width) * this.ratio;
		canvas.height = parseFloat(canvasStyle.height) * this.ratio;

		this.ctx = canvas.getContext("2d")!;
		this.ctx.fillStyle = "rgba(255,255,255,0.5)";

		this.ctx.lineJoin = "round";
		this.ctx.lineWidth = 20;

		this.draw = this.draw.bind(this);

		this.initBars();
	}

	getBarWidth() {
		return (this.canvas.width - BAR_GAP * (BAR_COUNT + 1)) / BAR_COUNT;
	}

	initBars() {
		for (let i = 0; i < BAR_COUNT; i++) {
			this.bars.push(new Bar());
		}
		this.resizeBars();
	}

	resizeBars() {
		const w = this.getBarWidth();
		const h = 300;
		const y = this.canvas.height - h;

		for (const [i, bar] of this.bars.entries()) {
			const x = i * (w + BAR_GAP) + BAR_GAP;
			bar.set(x, y, w, h);
		}
		this.draw();
	}

	update(array: number[]) {
		for (const [i, target] of this.bars.entries()) {
			target.update(array[i] ?? 0);
		}
		this.draw();
	}

	draw() {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.bars.forEach((t) => t.draw(this.ctx));
	}
}

class Bar {
	opacityScale = 0.3;
	heightScale = 0.3;
	smoothing = 0;
	normedAmp = 0;
	constructor(public x = 0, public y = 0, public w = 0, public h = 0) {}

	set(x: number, y: number, w: number, h: number) {
		this.x = x;
		this.y = y;
		this.w = w;
		this.h = h;
	}

	update(amplitude: number) {
		const normedAmp = amplitude / 255;

		const oldOpacityScaleTarget = 0.05 + 0.95 * this.normedAmp;
		const opacityScaleTarget = 0.05 + 0.95 * normedAmp;
		this.opacityScale = this.smoothing * oldOpacityScaleTarget + (1 - this.smoothing) * opacityScaleTarget;

		const oldHeightScaleTarget = 0.05 + 0.95 * this.normedAmp;
		const heightScaleTarget = 0.05 + 0.95 * normedAmp;
		this.heightScale = this.smoothing * oldHeightScaleTarget + (1 - this.smoothing) * heightScaleTarget;

		this.normedAmp = amplitude;
	}

	draw(ctx: CanvasRenderingContext2D) {
		ctx.fillStyle = `hsla(4, ${80 * this.opacityScale}%, 51%, ${this.opacityScale})`;

		const dy = this.h * (1 - this.heightScale);

		ctx.beginPath();
		ctx.rect(this.x, this.y + dy, this.w, this.h - dy);
		ctx.closePath();
		ctx.fill();
	}
}

/************************************************
				Instantiating
************************************************/

var player = await createPlayer();

var canvas = document.createElement("canvas");
canvas.style.top = "0";
canvas.style.left = "0";
canvas.style.position = "absolute";
canvas.style.pointerEvents = "none";
canvas.style.zIndex = "5";

function resizeCanvas() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	p.VC.resizeBars();
	p.VC.draw();
}

window.addEventListener("resize", resizeCanvas);

var m = document.getElementById("main")!;
m.appendChild(canvas);

var p = new PlayerW(canvas);
p.setAudio(player);

resizeCanvas();

const { cancel, resync } = await synchronizePlayer(player, 0.07);
const resyncHighDelta = resync("warning, found big currentTime playback delta:", 0.1);

p.onDrawPre = (self) => {
	resyncHighDelta(PlayerAPI.getState());
};
