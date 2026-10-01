/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LOGO } from "./logo.ts";

const KEY = "spicetify:splash:image";
const MAX_BYTES = 512 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const IMAGE_DATA = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

export function getSplashImage(): string {
	const image = localStorage.getItem(KEY);
	return image && image.length < MAX_BYTES * 1.4 && IMAGE_DATA.test(image) ? image : LOGO;
}

export function saveSplashImage(image: string): void {
	if (image.length >= MAX_BYTES * 1.4 || !IMAGE_DATA.test(image))
		throw new Error("Choose a supported image up to 512 KB.");
	localStorage.setItem(KEY, image);
}

export function resetSplashImage(): void {
	localStorage.removeItem(KEY);
}

export async function readSplashImage(file: File): Promise<string> {
	if (!IMAGE_TYPES.has(file.type)) throw new Error("Choose a PNG, JPEG, WebP, GIF, or SVG image.");
	if (file.size > MAX_BYTES) throw new Error("Choose an image up to 512 KB.");
	return new Promise((resolve, reject) => {
		const reader = new window.FileReader();
		reader.onerror = () => reject(new Error("The image could not be read. Choose another file."));
		reader.onload = () => {
			if (typeof reader.result === "string" && IMAGE_DATA.test(reader.result)) resolve(reader.result);
			else reject(new Error("The image could not be read. Choose another file."));
		};
		reader.readAsDataURL(file);
	});
}
