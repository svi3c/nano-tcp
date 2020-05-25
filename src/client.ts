import { EventEmitter } from "events";
import { Socket } from "net";
import { NanoSocket } from "./socket";
import {
  MessageBody,
  RequestParams,
  ResponseBody,
  MessageHandler,
} from "./types";
import { RequestError } from "./error";

export class NanoClient<T> extends EventEmitter {
  #nextRequestId = 1;
  #socket: NanoSocket;
  #retryCount = 0;
  #target: string | { host?: string; port: number };
  #reconnect: boolean;
  #reconnectTimeout: number | ((count: number) => number);
  #requests: { [id in number]: MessageHandler<any, any> } = {};
  #messageHandlers: {
    [topic in number | string]: Set<MessageHandler<any, any>>;
  } = {};
  #closed = true;

  constructor(
    target: string | { host?: string; port: number },
    {
      reconnect = true,
      reconnectTimeout = 1000,
    }: {
      reconnect?: boolean;
      reconnectTimeout?: number | ((count: number) => number);
    } = {}
  ) {
    super();
    const socket = new Socket();
    this.#socket = new NanoSocket(socket);
    this.#target = target;
    this.#reconnect = reconnect;
    this.#reconnectTimeout = reconnectTimeout;
    this.#socket.on("message", (message: string) => {
      const idx = message.indexOf("|", 2);
      const type = message[0];
      const topicOrRequestId = message.substring(1, idx);
      const payload = message.substr(idx + 1);
      switch (type) {
        case "<": {
          const requestId = Number(topicOrRequestId);
          this.#requests[requestId](payload);
          delete this.#requests[requestId];
          break;
        }
        case "!": {
          this.#messageHandlers[topicOrRequestId]?.forEach((handler) =>
            handler(payload)
          );
        }
      }
    });
  }

  send<K extends keyof T>(
    topic: K,
    ...[payload]: MessageBody<K, T> extends void ? [] : [MessageBody<K, T>]
  ) {
    return this.#socket.send(
      `!${topic}|${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }`
    );
  }

  async request<K extends keyof T>(
    topic: K,
    ...[payload, parse]: RequestParams<K, T>
  ): Promise<ResponseBody<K, T>> {
    const requestId = this.#nextRequestId++;
    return (
      await Promise.all([
        new Promise<any>((resolve, reject) => {
          this.#requests[requestId] = (res: any) => {
            const idx = res.indexOf("|");
            const code = res.substring(0, idx);
            const payload = res.substr(idx + 1);
            if (code === "0") {
              resolve(parse ? JSON.parse(payload) : payload);
            } else {
              reject(new RequestError(code, payload));
            }
          };
        }),
        this.#socket.send(
          `?${topic}|${requestId}|${
            typeof payload === "string" ? payload : JSON.stringify(payload)
          }`
        ),
      ])
    )[0];
  }

  async subscribe<K extends keyof T>(
    topic: K,
    handler: MessageHandler<K, T>,
    ...[parse]: T[K] extends {
      push?: infer Push;
    }
      ? Push extends string | void
        ? []
        : [true]
      : []
  ) {
    const fn = parse
      ? (payload: string) => handler(JSON.parse(payload))
      : (handler as any);
    const handlers =
      this.#messageHandlers[topic as number | string] || new Set();
    this.#messageHandlers[topic as number | string] = handlers;
    handlers.add(fn);
    const requestId = this.#nextRequestId++;
    if (handlers.size === 1) {
      await Promise.all([
        new Promise<any>((resolve) => {
          this.#requests[requestId] = resolve;
        }),
        this.#socket.send(`+${topic}|${requestId}`),
      ]);
    }
    return async () => {
      handlers.delete(fn);
      if (handlers.size === 0) {
        delete this.#messageHandlers[topic as number | string];
        await this.#socket.send(`-${topic}`);
      }
    };
  }

  async connect() {
    this.emit("connecting");
    const socket = this.#socket.socket;
    this.#closed = false;
    if (typeof this.#target === "string") {
      socket.connect(this.#target);
    } else {
      socket.connect(this.#target.port, this.#target.host!);
    }
    if (this.#reconnect) {
      socket.on("close", () => {
        if (!this.#closed) {
          const delay =
            typeof this.#reconnectTimeout === "function"
              ? this.#reconnectTimeout(this.#retryCount++)
              : this.#retryCount;
          setTimeout(() => this.connect(), delay);
        }
      });
    }
    socket.on("error", (e) => {
      console.warn(`Error connecting to ${this.#target}`);
      console.warn(e.stack || e);
      this.emit("error", e);
    });
  }

  async close() {
    this.#closed = true;
    this.#socket.socket.end();
  }
}
