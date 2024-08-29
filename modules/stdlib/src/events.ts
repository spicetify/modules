/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModuleInstance } from "/hooks/module.ts";

import { Platform } from "./expose/Platform.ts";

import { BehaviorSubject, Subscription } from "https://esm.sh/rxjs";
import { UpdateTitlebarSubject } from "./events.mix.ts";

const newEventBus = () => {
	const PlayerAPI = Platform.getPlayerAPI();
	const History = Platform.getHistory();

	const playerState = PlayerAPI.getState();
	return {
		Player: {
			state_updated: new BehaviorSubject(playerState),
			status_changed: new BehaviorSubject(playerState),
			song_changed: new BehaviorSubject(playerState),
		},
		History: {
			updated: new BehaviorSubject(History.location),
		},
		ControlMessage: {
			titlebar_updated: new BehaviorSubject<number>(-1),
		},
	};
};

const EventBus = newEventBus();
export type EventBus = typeof EventBus;

export const createEventBus = (mod: ModuleInstance) => {
	const eventBus = newEventBus();

	// TODO: come up with a nicer solution
	const s = new Subscription();
	s.add(EventBus.Player.song_changed.subscribe(eventBus.Player.song_changed));
	s.add(EventBus.Player.state_updated.subscribe(eventBus.Player.state_updated));
	s.add(EventBus.Player.status_changed.subscribe(eventBus.Player.status_changed));
	s.add(EventBus.History.updated.subscribe(eventBus.History.updated));
	s.add(EventBus.ControlMessage.titlebar_updated.subscribe(eventBus.ControlMessage.titlebar_updated));

	const unloadJs = mod._unloadJs!;
	mod._unloadJs = () => {
		s.unsubscribe();
		return unloadJs();
	};

	return eventBus;
};

let cachedState = {};
const playerListener = ({ data: state }) => {
	EventBus.Player.state_updated.next(state);
	if (state?.item?.uri !== cachedState?.item?.uri) EventBus.Player.song_changed.next(state);
	if (state?.isPaused !== cachedState?.isPaused || state?.isBuffering !== cachedState?.isBuffering) {
		EventBus.Player.status_changed.next(state);
	}
	cachedState = state;
};

const historyListener = (location) => EventBus.History.updated.next(location);

const updateTitlebarListener = (height: number) => EventBus.ControlMessage.titlebar_updated.next(height);

export function startEventHandlers() {
	const cancelPlayerListener = Platform.getPlayerAPI().getEvents().addListener("update", playerListener);
	const cancelHistoryListener = Platform.getHistory().listen(historyListener);
	const updateTitlebarListenerSubscription = UpdateTitlebarSubject.subscribe(updateTitlebarListener);

	return () => {
		cancelPlayerListener();
		cancelHistoryListener();
		updateTitlebarListenerSubscription.unsubscribe();
	};
}
