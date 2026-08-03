/*!
 * rxjs 7.8.2 (Apache-2.0), prebundled subset: BehaviorSubject, Subject,
 * Subscription. Generated from the rxjs package so stdlib boots without the
 * network; regenerate by bundling: export { BehaviorSubject, Subject,
 * Subscription } from "rxjs".
 */
//#region ../../../../.cache/nub/pm/store/tslib@2.8.1-249614bcbc29b17a/node_modules/tslib/tslib.es6.mjs
/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
var extendStatics = function(d, b) {
	extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d, b) {
		d.__proto__ = b;
	} || function(d, b) {
		for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
	};
	return extendStatics(d, b);
};
function __extends(d, b) {
	if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
	extendStatics(d, b);
	function __() {
		this.constructor = d;
	}
	d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}
function __values(o) {
	var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
	if (m) return m.call(o);
	if (o && typeof o.length === "number") return { next: function() {
		if (o && i >= o.length) o = void 0;
		return {
			value: o && o[i++],
			done: !o
		};
	} };
	throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
}
function __read(o, n) {
	var m = typeof Symbol === "function" && o[Symbol.iterator];
	if (!m) return o;
	var i = m.call(o), r, ar = [], e;
	try {
		while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
	} catch (error) {
		e = { error };
	} finally {
		try {
			if (r && !r.done && (m = i["return"])) m.call(i);
		} finally {
			if (e) throw e.error;
		}
	}
	return ar;
}
function __spreadArray(to, from, pack) {
	if (pack || arguments.length === 2) {
		for (var i = 0, l = from.length, ar; i < l; i++) if (ar || !(i in from)) {
			if (!ar) ar = Array.prototype.slice.call(from, 0, i);
			ar[i] = from[i];
		}
	}
	return to.concat(ar || Array.prototype.slice.call(from));
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/util/isFunction.js
function isFunction(value) {
	return typeof value === "function";
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/util/createErrorClass.js
function createErrorClass(createImpl) {
	var _super = function(instance) {
		Error.call(instance);
		instance.stack = (/* @__PURE__ */ new Error()).stack;
	};
	var ctorFunc = createImpl(_super);
	ctorFunc.prototype = Object.create(Error.prototype);
	ctorFunc.prototype.constructor = ctorFunc;
	return ctorFunc;
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/util/UnsubscriptionError.js
var UnsubscriptionError = createErrorClass(function(_super) {
	return function UnsubscriptionErrorImpl(errors) {
		_super(this);
		this.message = errors ? errors.length + " errors occurred during unsubscription:\n" + errors.map(function(err, i) {
			return i + 1 + ") " + err.toString();
		}).join("\n  ") : "";
		this.name = "UnsubscriptionError";
		this.errors = errors;
	};
});
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/util/arrRemove.js
function arrRemove(arr, item) {
	if (arr) {
		var index = arr.indexOf(item);
		0 <= index && arr.splice(index, 1);
	}
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/Subscription.js
var Subscription = function() {
	function Subscription(initialTeardown) {
		this.initialTeardown = initialTeardown;
		this.closed = false;
		this._parentage = null;
		this._finalizers = null;
	}
	Subscription.prototype.unsubscribe = function() {
		var e_1, _a, e_2, _b;
		var errors;
		if (!this.closed) {
			this.closed = true;
			var _parentage = this._parentage;
			if (_parentage) {
				this._parentage = null;
				if (Array.isArray(_parentage)) try {
					for (var _parentage_1 = __values(_parentage), _parentage_1_1 = _parentage_1.next(); !_parentage_1_1.done; _parentage_1_1 = _parentage_1.next()) _parentage_1_1.value.remove(this);
				} catch (e_1_1) {
					e_1 = { error: e_1_1 };
				} finally {
					try {
						if (_parentage_1_1 && !_parentage_1_1.done && (_a = _parentage_1.return)) _a.call(_parentage_1);
					} finally {
						if (e_1) throw e_1.error;
					}
				}
				else _parentage.remove(this);
			}
			var initialFinalizer = this.initialTeardown;
			if (isFunction(initialFinalizer)) try {
				initialFinalizer();
			} catch (e) {
				errors = e instanceof UnsubscriptionError ? e.errors : [e];
			}
			var _finalizers = this._finalizers;
			if (_finalizers) {
				this._finalizers = null;
				try {
					for (var _finalizers_1 = __values(_finalizers), _finalizers_1_1 = _finalizers_1.next(); !_finalizers_1_1.done; _finalizers_1_1 = _finalizers_1.next()) {
						var finalizer = _finalizers_1_1.value;
						try {
							execFinalizer(finalizer);
						} catch (err) {
							errors = errors !== null && errors !== void 0 ? errors : [];
							if (err instanceof UnsubscriptionError) errors = __spreadArray(__spreadArray([], __read(errors)), __read(err.errors));
							else errors.push(err);
						}
					}
				} catch (e_2_1) {
					e_2 = { error: e_2_1 };
				} finally {
					try {
						if (_finalizers_1_1 && !_finalizers_1_1.done && (_b = _finalizers_1.return)) _b.call(_finalizers_1);
					} finally {
						if (e_2) throw e_2.error;
					}
				}
			}
			if (errors) throw new UnsubscriptionError(errors);
		}
	};
	Subscription.prototype.add = function(teardown) {
		var _a;
		if (teardown && teardown !== this) if (this.closed) execFinalizer(teardown);
		else {
			if (teardown instanceof Subscription) {
				if (teardown.closed || teardown._hasParent(this)) return;
				teardown._addParent(this);
			}
			(this._finalizers = (_a = this._finalizers) !== null && _a !== void 0 ? _a : []).push(teardown);
		}
	};
	Subscription.prototype._hasParent = function(parent) {
		var _parentage = this._parentage;
		return _parentage === parent || Array.isArray(_parentage) && _parentage.includes(parent);
	};
	Subscription.prototype._addParent = function(parent) {
		var _parentage = this._parentage;
		this._parentage = Array.isArray(_parentage) ? (_parentage.push(parent), _parentage) : _parentage ? [_parentage, parent] : parent;
	};
	Subscription.prototype._removeParent = function(parent) {
		var _parentage = this._parentage;
		if (_parentage === parent) this._parentage = null;
		else if (Array.isArray(_parentage)) arrRemove(_parentage, parent);
	};
	Subscription.prototype.remove = function(teardown) {
		var _finalizers = this._finalizers;
		_finalizers && arrRemove(_finalizers, teardown);
		if (teardown instanceof Subscription) teardown._removeParent(this);
	};
	Subscription.EMPTY = (function() {
		var empty = new Subscription();
		empty.closed = true;
		return empty;
	})();
	return Subscription;
}();
var EMPTY_SUBSCRIPTION = Subscription.EMPTY;
function isSubscription(value) {
	return value instanceof Subscription || value && "closed" in value && isFunction(value.remove) && isFunction(value.add) && isFunction(value.unsubscribe);
}
function execFinalizer(finalizer) {
	if (isFunction(finalizer)) finalizer();
	else finalizer.unsubscribe();
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/config.js
var config = {
	onUnhandledError: null,
	onStoppedNotification: null,
	Promise: void 0,
	useDeprecatedSynchronousErrorHandling: false,
	useDeprecatedNextContext: false
};
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/scheduler/timeoutProvider.js
var timeoutProvider = {
	setTimeout: function(handler, timeout) {
		var args = [];
		for (var _i = 2; _i < arguments.length; _i++) args[_i - 2] = arguments[_i];
		var delegate = timeoutProvider.delegate;
		if (delegate === null || delegate === void 0 ? void 0 : delegate.setTimeout) return delegate.setTimeout.apply(delegate, __spreadArray([handler, timeout], __read(args)));
		return setTimeout.apply(void 0, __spreadArray([handler, timeout], __read(args)));
	},
	clearTimeout: function(handle) {
		var delegate = timeoutProvider.delegate;
		return ((delegate === null || delegate === void 0 ? void 0 : delegate.clearTimeout) || clearTimeout)(handle);
	},
	delegate: void 0
};
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/util/reportUnhandledError.js
function reportUnhandledError(err) {
	timeoutProvider.setTimeout(function() {
		var onUnhandledError = config.onUnhandledError;
		if (onUnhandledError) onUnhandledError(err);
		else throw err;
	});
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/util/noop.js
function noop() {}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/NotificationFactories.js
var COMPLETE_NOTIFICATION = (function() {
	return createNotification("C", void 0, void 0);
})();
function errorNotification(error) {
	return createNotification("E", void 0, error);
}
function nextNotification(value) {
	return createNotification("N", value, void 0);
}
function createNotification(kind, value, error) {
	return {
		kind,
		value,
		error
	};
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/util/errorContext.js
var context = null;
function errorContext(cb) {
	if (config.useDeprecatedSynchronousErrorHandling) {
		var isRoot = !context;
		if (isRoot) context = {
			errorThrown: false,
			error: null
		};
		cb();
		if (isRoot) {
			var _a = context, errorThrown = _a.errorThrown, error = _a.error;
			context = null;
			if (errorThrown) throw error;
		}
	} else cb();
}
function captureError(err) {
	if (config.useDeprecatedSynchronousErrorHandling && context) {
		context.errorThrown = true;
		context.error = err;
	}
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/Subscriber.js
var Subscriber = function(_super) {
	__extends(Subscriber, _super);
	function Subscriber(destination) {
		var _this = _super.call(this) || this;
		_this.isStopped = false;
		if (destination) {
			_this.destination = destination;
			if (isSubscription(destination)) destination.add(_this);
		} else _this.destination = EMPTY_OBSERVER;
		return _this;
	}
	Subscriber.create = function(next, error, complete) {
		return new SafeSubscriber(next, error, complete);
	};
	Subscriber.prototype.next = function(value) {
		if (this.isStopped) handleStoppedNotification(nextNotification(value), this);
		else this._next(value);
	};
	Subscriber.prototype.error = function(err) {
		if (this.isStopped) handleStoppedNotification(errorNotification(err), this);
		else {
			this.isStopped = true;
			this._error(err);
		}
	};
	Subscriber.prototype.complete = function() {
		if (this.isStopped) handleStoppedNotification(COMPLETE_NOTIFICATION, this);
		else {
			this.isStopped = true;
			this._complete();
		}
	};
	Subscriber.prototype.unsubscribe = function() {
		if (!this.closed) {
			this.isStopped = true;
			_super.prototype.unsubscribe.call(this);
			this.destination = null;
		}
	};
	Subscriber.prototype._next = function(value) {
		this.destination.next(value);
	};
	Subscriber.prototype._error = function(err) {
		try {
			this.destination.error(err);
		} finally {
			this.unsubscribe();
		}
	};
	Subscriber.prototype._complete = function() {
		try {
			this.destination.complete();
		} finally {
			this.unsubscribe();
		}
	};
	return Subscriber;
}(Subscription);
var _bind = Function.prototype.bind;
function bind(fn, thisArg) {
	return _bind.call(fn, thisArg);
}
var ConsumerObserver = function() {
	function ConsumerObserver(partialObserver) {
		this.partialObserver = partialObserver;
	}
	ConsumerObserver.prototype.next = function(value) {
		var partialObserver = this.partialObserver;
		if (partialObserver.next) try {
			partialObserver.next(value);
		} catch (error) {
			handleUnhandledError(error);
		}
	};
	ConsumerObserver.prototype.error = function(err) {
		var partialObserver = this.partialObserver;
		if (partialObserver.error) try {
			partialObserver.error(err);
		} catch (error) {
			handleUnhandledError(error);
		}
		else handleUnhandledError(err);
	};
	ConsumerObserver.prototype.complete = function() {
		var partialObserver = this.partialObserver;
		if (partialObserver.complete) try {
			partialObserver.complete();
		} catch (error) {
			handleUnhandledError(error);
		}
	};
	return ConsumerObserver;
}();
var SafeSubscriber = function(_super) {
	__extends(SafeSubscriber, _super);
	function SafeSubscriber(observerOrNext, error, complete) {
		var _this = _super.call(this) || this;
		var partialObserver;
		if (isFunction(observerOrNext) || !observerOrNext) partialObserver = {
			next: observerOrNext !== null && observerOrNext !== void 0 ? observerOrNext : void 0,
			error: error !== null && error !== void 0 ? error : void 0,
			complete: complete !== null && complete !== void 0 ? complete : void 0
		};
		else {
			var context_1;
			if (_this && config.useDeprecatedNextContext) {
				context_1 = Object.create(observerOrNext);
				context_1.unsubscribe = function() {
					return _this.unsubscribe();
				};
				partialObserver = {
					next: observerOrNext.next && bind(observerOrNext.next, context_1),
					error: observerOrNext.error && bind(observerOrNext.error, context_1),
					complete: observerOrNext.complete && bind(observerOrNext.complete, context_1)
				};
			} else partialObserver = observerOrNext;
		}
		_this.destination = new ConsumerObserver(partialObserver);
		return _this;
	}
	return SafeSubscriber;
}(Subscriber);
function handleUnhandledError(error) {
	if (config.useDeprecatedSynchronousErrorHandling) captureError(error);
	else reportUnhandledError(error);
}
function defaultErrorHandler(err) {
	throw err;
}
function handleStoppedNotification(notification, subscriber) {
	var onStoppedNotification = config.onStoppedNotification;
	onStoppedNotification && timeoutProvider.setTimeout(function() {
		return onStoppedNotification(notification, subscriber);
	});
}
var EMPTY_OBSERVER = {
	closed: true,
	next: noop,
	error: defaultErrorHandler,
	complete: noop
};
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/symbol/observable.js
var observable = (function() {
	return typeof Symbol === "function" && Symbol.observable || "@@observable";
})();
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/util/identity.js
function identity(x) {
	return x;
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/util/pipe.js
function pipeFromArray(fns) {
	if (fns.length === 0) return identity;
	if (fns.length === 1) return fns[0];
	return function piped(input) {
		return fns.reduce(function(prev, fn) {
			return fn(prev);
		}, input);
	};
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/Observable.js
var Observable = function() {
	function Observable(subscribe) {
		if (subscribe) this._subscribe = subscribe;
	}
	Observable.prototype.lift = function(operator) {
		var observable = new Observable();
		observable.source = this;
		observable.operator = operator;
		return observable;
	};
	Observable.prototype.subscribe = function(observerOrNext, error, complete) {
		var _this = this;
		var subscriber = isSubscriber(observerOrNext) ? observerOrNext : new SafeSubscriber(observerOrNext, error, complete);
		errorContext(function() {
			var _a = _this, operator = _a.operator, source = _a.source;
			subscriber.add(operator ? operator.call(subscriber, source) : source ? _this._subscribe(subscriber) : _this._trySubscribe(subscriber));
		});
		return subscriber;
	};
	Observable.prototype._trySubscribe = function(sink) {
		try {
			return this._subscribe(sink);
		} catch (err) {
			sink.error(err);
		}
	};
	Observable.prototype.forEach = function(next, promiseCtor) {
		var _this = this;
		promiseCtor = getPromiseCtor(promiseCtor);
		return new promiseCtor(function(resolve, reject) {
			var subscriber = new SafeSubscriber({
				next: function(value) {
					try {
						next(value);
					} catch (err) {
						reject(err);
						subscriber.unsubscribe();
					}
				},
				error: reject,
				complete: resolve
			});
			_this.subscribe(subscriber);
		});
	};
	Observable.prototype._subscribe = function(subscriber) {
		var _a;
		return (_a = this.source) === null || _a === void 0 ? void 0 : _a.subscribe(subscriber);
	};
	Observable.prototype[observable] = function() {
		return this;
	};
	Observable.prototype.pipe = function() {
		var operations = [];
		for (var _i = 0; _i < arguments.length; _i++) operations[_i] = arguments[_i];
		return pipeFromArray(operations)(this);
	};
	Observable.prototype.toPromise = function(promiseCtor) {
		var _this = this;
		promiseCtor = getPromiseCtor(promiseCtor);
		return new promiseCtor(function(resolve, reject) {
			var value;
			_this.subscribe(function(x) {
				return value = x;
			}, function(err) {
				return reject(err);
			}, function() {
				return resolve(value);
			});
		});
	};
	Observable.create = function(subscribe) {
		return new Observable(subscribe);
	};
	return Observable;
}();
function getPromiseCtor(promiseCtor) {
	var _a;
	return (_a = promiseCtor !== null && promiseCtor !== void 0 ? promiseCtor : config.Promise) !== null && _a !== void 0 ? _a : Promise;
}
function isObserver(value) {
	return value && isFunction(value.next) && isFunction(value.error) && isFunction(value.complete);
}
function isSubscriber(value) {
	return value && value instanceof Subscriber || isObserver(value) && isSubscription(value);
}
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/util/ObjectUnsubscribedError.js
var ObjectUnsubscribedError = createErrorClass(function(_super) {
	return function ObjectUnsubscribedErrorImpl() {
		_super(this);
		this.name = "ObjectUnsubscribedError";
		this.message = "object unsubscribed";
	};
});
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/Subject.js
var Subject = function(_super) {
	__extends(Subject, _super);
	function Subject() {
		var _this = _super.call(this) || this;
		_this.closed = false;
		_this.currentObservers = null;
		_this.observers = [];
		_this.isStopped = false;
		_this.hasError = false;
		_this.thrownError = null;
		return _this;
	}
	Subject.prototype.lift = function(operator) {
		var subject = new AnonymousSubject(this, this);
		subject.operator = operator;
		return subject;
	};
	Subject.prototype._throwIfClosed = function() {
		if (this.closed) throw new ObjectUnsubscribedError();
	};
	Subject.prototype.next = function(value) {
		var _this = this;
		errorContext(function() {
			var e_1, _a;
			_this._throwIfClosed();
			if (!_this.isStopped) {
				if (!_this.currentObservers) _this.currentObservers = Array.from(_this.observers);
				try {
					for (var _b = __values(_this.currentObservers), _c = _b.next(); !_c.done; _c = _b.next()) _c.value.next(value);
				} catch (e_1_1) {
					e_1 = { error: e_1_1 };
				} finally {
					try {
						if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
					} finally {
						if (e_1) throw e_1.error;
					}
				}
			}
		});
	};
	Subject.prototype.error = function(err) {
		var _this = this;
		errorContext(function() {
			_this._throwIfClosed();
			if (!_this.isStopped) {
				_this.hasError = _this.isStopped = true;
				_this.thrownError = err;
				var observers = _this.observers;
				while (observers.length) observers.shift().error(err);
			}
		});
	};
	Subject.prototype.complete = function() {
		var _this = this;
		errorContext(function() {
			_this._throwIfClosed();
			if (!_this.isStopped) {
				_this.isStopped = true;
				var observers = _this.observers;
				while (observers.length) observers.shift().complete();
			}
		});
	};
	Subject.prototype.unsubscribe = function() {
		this.isStopped = this.closed = true;
		this.observers = this.currentObservers = null;
	};
	Object.defineProperty(Subject.prototype, "observed", {
		get: function() {
			var _a;
			return ((_a = this.observers) === null || _a === void 0 ? void 0 : _a.length) > 0;
		},
		enumerable: false,
		configurable: true
	});
	Subject.prototype._trySubscribe = function(subscriber) {
		this._throwIfClosed();
		return _super.prototype._trySubscribe.call(this, subscriber);
	};
	Subject.prototype._subscribe = function(subscriber) {
		this._throwIfClosed();
		this._checkFinalizedStatuses(subscriber);
		return this._innerSubscribe(subscriber);
	};
	Subject.prototype._innerSubscribe = function(subscriber) {
		var _this = this;
		var _a = this, hasError = _a.hasError, isStopped = _a.isStopped, observers = _a.observers;
		if (hasError || isStopped) return EMPTY_SUBSCRIPTION;
		this.currentObservers = null;
		observers.push(subscriber);
		return new Subscription(function() {
			_this.currentObservers = null;
			arrRemove(observers, subscriber);
		});
	};
	Subject.prototype._checkFinalizedStatuses = function(subscriber) {
		var _a = this, hasError = _a.hasError, thrownError = _a.thrownError, isStopped = _a.isStopped;
		if (hasError) subscriber.error(thrownError);
		else if (isStopped) subscriber.complete();
	};
	Subject.prototype.asObservable = function() {
		var observable = new Observable();
		observable.source = this;
		return observable;
	};
	Subject.create = function(destination, source) {
		return new AnonymousSubject(destination, source);
	};
	return Subject;
}(Observable);
var AnonymousSubject = function(_super) {
	__extends(AnonymousSubject, _super);
	function AnonymousSubject(destination, source) {
		var _this = _super.call(this) || this;
		_this.destination = destination;
		_this.source = source;
		return _this;
	}
	AnonymousSubject.prototype.next = function(value) {
		var _a, _b;
		(_b = (_a = this.destination) === null || _a === void 0 ? void 0 : _a.next) === null || _b === void 0 || _b.call(_a, value);
	};
	AnonymousSubject.prototype.error = function(err) {
		var _a, _b;
		(_b = (_a = this.destination) === null || _a === void 0 ? void 0 : _a.error) === null || _b === void 0 || _b.call(_a, err);
	};
	AnonymousSubject.prototype.complete = function() {
		var _a, _b;
		(_b = (_a = this.destination) === null || _a === void 0 ? void 0 : _a.complete) === null || _b === void 0 || _b.call(_a);
	};
	AnonymousSubject.prototype._subscribe = function(subscriber) {
		var _a, _b;
		return (_b = (_a = this.source) === null || _a === void 0 ? void 0 : _a.subscribe(subscriber)) !== null && _b !== void 0 ? _b : EMPTY_SUBSCRIPTION;
	};
	return AnonymousSubject;
}(Subject);
//#endregion
//#region ../../../../.cache/nub/pm/store/rxjs@7.8.2-d3849b643319d3be/node_modules/rxjs/dist/esm5/internal/BehaviorSubject.js
var BehaviorSubject = function(_super) {
	__extends(BehaviorSubject, _super);
	function BehaviorSubject(_value) {
		var _this = _super.call(this) || this;
		_this._value = _value;
		return _this;
	}
	Object.defineProperty(BehaviorSubject.prototype, "value", {
		get: function() {
			return this.getValue();
		},
		enumerable: false,
		configurable: true
	});
	BehaviorSubject.prototype._subscribe = function(subscriber) {
		var subscription = _super.prototype._subscribe.call(this, subscriber);
		!subscription.closed && subscriber.next(this._value);
		return subscription;
	};
	BehaviorSubject.prototype.getValue = function() {
		var _a = this, hasError = _a.hasError, thrownError = _a.thrownError, _value = _a._value;
		if (hasError) throw thrownError;
		this._throwIfClosed();
		return _value;
	};
	BehaviorSubject.prototype.next = function(value) {
		_super.prototype.next.call(this, this._value = value);
	};
	return BehaviorSubject;
}(Subject);
//#endregion
export { BehaviorSubject, Subject, Subscription };
