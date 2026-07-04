import { describe, it, expect } from "vitest";
import { extractYouTubeVideoId, isPlaylistOnly } from "../../src/util/url.js";

describe("extractYouTubeVideoId", () => {
  it("parses standard watch URLs", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses youtu.be short URLs", () => {
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses Shorts URLs", () => {
    expect(extractYouTubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("extracts the video id even when a playlist param is present", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz")).toBe("dQw4w9WgXcQ");
  });
  it("returns null for a playlist-only URL", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/playlist?list=PLxyz")).toBeNull();
  });
  it("returns null for a non-YouTube URL", () => {
    expect(extractYouTubeVideoId("https://vimeo.com/12345")).toBeNull();
  });
});

describe("isPlaylistOnly", () => {
  it("is true for a playlist URL without a video id", () => {
    expect(isPlaylistOnly("https://www.youtube.com/playlist?list=PLxyz")).toBe(true);
  });
  it("is false for a watch URL", () => {
    expect(isPlaylistOnly("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
  });
});
