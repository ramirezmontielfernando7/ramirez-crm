// One flight per identity epoch. No timers, polling or system background jobs.
export class SyncFlights {
  private flights = new Map<number, Promise<void>>();
  run(epoch: number, work: () => Promise<void>) {
    const previous = this.flights.get(epoch);
    if (previous) return previous;
    const promise = Promise.resolve()
      .then(work)
      .finally(() => this.flights.delete(epoch));
    this.flights.set(epoch, promise);
    return promise;
  }
}
