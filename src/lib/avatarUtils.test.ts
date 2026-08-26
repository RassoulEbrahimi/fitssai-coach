import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getAvatarUrl, uploadAvatar, updateProfileAvatar } from "./avatarUtils";

const read = (rel: string) => readFileSync(resolve(__dirname, "..", "..", rel), "utf8");

describe("avatar helper signatures", () => {
  it("getAvatarUrl takes a single path argument", () => {
    expect(getAvatarUrl.length).toBe(1);
    expect(getAvatarUrl("some/path.png")).toBeNull();
    expect(getAvatarUrl(null)).toBeNull();
  });

  it("uploadAvatar takes (file, userId) in that order", () => {
    expect(uploadAvatar.length).toBe(2);
  });

  it("updateProfileAvatar takes (userId, avatarPath)", () => {
    expect(updateProfileAvatar.length).toBe(2);
  });

  it("uploadAvatar reports that the feature is unavailable", async () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    await expect(uploadAvatar(file, "user-1")).rejects.toThrow(/nicht zur Verf/);
  });
});

describe("avatar call sites pass arguments in the right order", () => {
  /*
   * Regression: both call sites passed (userId, file) — reversed — and one
   * also passed a progress callback uploadAvatar does not accept. The helper
   * currently throws, so this never surfaced at runtime; it would have the
   * moment avatar upload is re-enabled.
   */
  it.each([
    ["src/components/ProfileCard.tsx", /uploadAvatar\(\s*compressedFile\s*,\s*user\.id\s*\)/],
    ["src/views/ProfileView.tsx", /uploadAvatar\(\s*selectedFile\s*,\s*profile\.id\s*\)/],
  ])("%s passes the File first", (file, pattern) => {
    const source = read(file);
    expect(source).toMatch(pattern);
    // And never the reversed form.
    expect(source).not.toMatch(/uploadAvatar\(\s*(user|profile)\.id\s*,/);
  });

  it("does not pass a progress callback uploadAvatar cannot accept", () => {
    expect(read("src/components/ProfileCard.tsx")).not.toMatch(
      /uploadAvatar\([\s\S]{0,120}\(progress\)\s*=>/
    );
  });

  it("calls getAvatarUrl with one argument", () => {
    expect(read("src/components/ProfileCard.tsx")).toMatch(
      /getAvatarUrl\(profile\?\.avatar_path\)/
    );
  });
});

describe("user display name uses the Firebase field", () => {
  it("no longer reads the Supabase-era user_metadata", () => {
    // AppUser extends FirebaseUser, which has displayName, not user_metadata,
    // so the name could never render.
    const source = read("src/components/ProfileCard.tsx");
    expect(source).not.toContain("user_metadata");
    expect(source).toMatch(/user\?\.displayName \|\| user\?\.email/);
  });
});
