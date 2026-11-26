-- 0004: where the sign-in library keeps its count of attempts.
-- The library held the count in memory, on an instance that lives for one
-- request, and switched itself on only when told it runs in production: its
-- limits never held, and a password could be guessed at full speed. Kept in
-- the database they hold for the whole site. One row per address and path;
-- the library prunes rows whose window has passed.
-- Apply BEFORE deploying the code that sets rateLimit.storage to "database":
-- that code reads this table on every sign-in request.
-- Written from the library's own definition of the table.

CREATE TABLE `rate_limit` (
  `id` text PRIMARY KEY NOT NULL,
  `key` text NOT NULL,
  `count` integer NOT NULL,
  `last_request` integer NOT NULL
);
--> statement-breakpoint--
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);
