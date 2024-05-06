/* Copyright © 2024
 *      Delusoire <deluso7re@outlook.com>
 *
 * This file is part of bespoke/modules/stdlib.
 *
 * bespoke/modules/stdlib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * bespoke/modules/stdlib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with bespoke/modules/stdlib. If not, see <https://www.gnu.org/licenses/>.
 */

export const xfetch = (input, init, onFetch)=>{
    let url;
    if (typeof input === "string") {
        url = new URL(input);
    } else if (input instanceof Request) {
        url = new URL(input.url);
    } else if (input instanceof URL) {
        url = input;
    } else {
        throw "Unsupported input type";
    }
    url.host = `${url.host.replaceAll(".", "-20")}.delusoire.top`;
    init ??= {};
    let headers;
    if (init.headers) {
        headers = new Headers(init.headers);
    } else if (input instanceof Request) {
        headers = input.headers;
    } else {
        headers = new Headers();
    }
    const _headers = new Headers();
    _headers.set("X-Set-Headers", JSON.stringify(Object.fromEntries(headers.entries())));
    init.headers = _headers;
    if (input instanceof Request) {
        // @ts-ignore
        input.duplex = "half";
    }
    const request = new Request(url, input instanceof Request ? input : undefined);
    onFetch(request, init);
    return fetch(request, init);
};
