/**
 * Training nudges.
 *
 * `eligibility` decides whether there is anything truthful to say today, from
 * the plan and the stored logs alone. `copy` says it, in fixed German that no
 * model generates. `delivery` gets it in front of the user through the one
 * channel this architecture actually has — a notification raised by the
 * running app — and remembers, per device, what it already showed.
 *
 * Nothing in here writes to a plan, a log or any other user document.
 */
export * from "./copy";
export * from "./eligibility";
export * from "./delivery";
