import { EventEmitter } from "events";

type JobFunction<P extends any[], T> = (...params: P) => Promise<T>;

class Job<K, P extends any[], T, E> extends EventEmitter {
  constructor(
    public key: K,
    public params: P,
    public fn: JobFunction<P, T>,
    public status: "none" | "running" | "success" | "error" = "none",
    public result?: T,
    public error?: E,
    private successCallbacks: ((job: T) => void)[] = [],
    private errorCallbacks: ((job: E) => void)[] = [],
  ) {
    super();
  }

  public async run(): Promise<void> {
    if (this.status !== "none") {
      throw new Error("Cannot run job multiple times.");
    }

    this.status = "running";
    this.emit("run");

    try {
      this.result = await this.fn(...this.params);
      this.status = "success";
      this.successCallbacks.forEach(cb => cb(this.result!));
      this.emit("success");
    } catch (error) {
      this.error = error as E;
      this.status = "error";
      this.errorCallbacks.forEach(cb => cb(this.error!));
      this.emit("error");
    }
  }

  public async awaitResult(): Promise<T> {
    switch (this.status) {
      case "none":
      case "running":
        // create an externally resolved promise
        let promiseResolve: ((result: T) => void) | undefined;
        let promiseReject: ((error: E) => void) | undefined;
        const promise = new Promise<T>((resolve, reject) => {
          promiseResolve = resolve;
          promiseReject = reject;
        });

        // append the promise resolvers as callbacks to the job
        this.successCallbacks.push(promiseResolve!);
        this.errorCallbacks.push(promiseReject!);

        // return the promise
        return promise;
      case "success":
        // return the result
        return Promise.resolve(this.result!);
      case "error":
        // return the error
        return Promise.reject(this.error!);
    }
  }
}

export default class JobCache<T, K = string, P extends any[] = [K], E = unknown> extends EventEmitter {
  private jobs: Map<K, Job<K, P, T, E>> = new Map();
  private queue: Job<K, P, T, E>[] = [];
  private activeCount = 0;

  constructor(private readonly concurrency = Infinity) {
    super();
  }

  private startJob(job: Job<K, P, T, E>): void {
    this.activeCount++;
    job.run().finally(() => {
      this.activeCount--;
      if (this.queue.length > 0) {
        this.startJob(this.queue.shift()!);
      }
    });
  }

  private createJob(key: K, params: P, fn: JobFunction<P, T>): Job<K, P, T, E> {
    const job = new Job<K, P, T, E>(key, params, fn);
    this.jobs.set(key, job);

    // setup event callbacks
    job.on("run", () => this.emit("run", key));
    job.on("success", () => this.emit("success", key));
    job.on("error", () => this.emit("error", key));

    // run immediately or queue if at concurrency limit
    if (this.activeCount < this.concurrency) {
      this.startJob(job);
    } else {
      this.queue.push(job);
    }

    return job;
  }

  public async get(key: K, fn: JobFunction<P, T>, ...params: P): Promise<T> {
    const job = this.jobs.get(key) ?? this.createJob(key, params, fn);
    return job.awaitResult();
  };

  public getCached(key: K): T | undefined {
    const job = this.jobs.get(key);
    return job?.status === "success" ? job.result! : undefined;
  }

  public getJobStatus(key: K): Job<K, P, T, E>["status"] {
    return this.jobs.get(key)?.status ?? "none";
  }
}
