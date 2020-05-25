import { Server } from "net";
import { NanoClient } from "./client";
import { NanoServer } from "./server";

interface Api {
  1: {
    msg: {
      foo: "bar";
    };
    push: {
      foo: "bar";
    };
    req: {
      foo: "bar";
    };
    res: { bar: "baz" };
  };
}

describe("NanoServer + NanoClient", () => {
  let server: Server;
  let ns: NanoServer<Api>;
  let nc: NanoClient<Api>;

  beforeEach(async () => {
    server = new Server();
    await new Promise((resolve) => server.listen(3333, resolve));
    ns = new NanoServer<Api>(server);
    nc = new NanoClient<Api>({ port: 3333 });
    ns.listen();
    nc.connect();
  });

  afterEach(() => {
    nc.close();
    return new Promise((resolve) => server.close(resolve));
  });

  describe("send()", () => {
    it("should send and receive a message", async () => {
      const result = new Promise((resolve) => ns.onMessage(1, resolve, true));
      await nc.send(1, { foo: "bar" });
      expect(await result).toEqual({ foo: "bar" });
    });
  });

  describe("request()", () => {
    it("should send a request and response message", async () => {
      ns.onRequest(
        1,
        (payload) => {
          expect(payload).toEqual({ foo: "bar" });
          return { bar: "baz" } as { bar: "baz" };
        },
        true
      );
      expect(await nc.request(1, { foo: "bar" }, true)).toEqual({ bar: "baz" });
    });
  });

  describe("subscribe()", () => {
    it("should register for multicast messages", async () => {
      expect.assertions(1);
      await nc.subscribe(1, (m) => expect(m).toEqual({ foo: "bar" }), true);
      await ns.push(1, { foo: "bar" });
    });
  });
});
