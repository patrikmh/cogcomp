import { usePreferences } from "./preferences";
import { getItem, setItem } from "./storage";

jest.mock("./storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(async () => undefined),
  deleteItem: jest.fn(async () => undefined),
}));

const stored = getItem as jest.MockedFunction<typeof getItem>;
const wrote = setItem as jest.MockedFunction<typeof setItem>;

beforeEach(() => {
  jest.clearAllMocks();
  usePreferences.setState({ voice: true, developer: false, findings: true, ready: false });
});

describe("defaults", () => {
  it("speaks by default", () => {
    expect(usePreferences.getState().voice).toBe(true);
  });

  it("hides developer surfaces by default", () => {
    // A journal should not open onto a control panel.
    expect(usePreferences.getState().developer).toBe(false);
  });

  it("shows findings by default", () => {
    // The thing the app is for. Off is a choice someone makes, never the
    // starting state.
    expect(usePreferences.getState().findings).toBe(true);
  });

  it("keeps findings off across a restart once turned off", async () => {
    // Someone who switched this off in a bad week must not be shown patterns
    // again simply because they closed the app.
    stored.mockImplementation(async (key: string) =>
      key === "tlon.findings" ? "false" : null,
    );

    await usePreferences.getState().restore();

    expect(usePreferences.getState().findings).toBe(false);
  });

  it("writes the findings choice where a restart will find it", async () => {
    await usePreferences.getState().setFindings(false);

    expect(wrote).toHaveBeenCalledWith("tlon.findings", "false");
    expect(usePreferences.getState().findings).toBe(false);
  });

  it("is not ready until storage has been read", () => {
    // Screens gate on this, so a false start would flash defaults at someone who
    // has already chosen otherwise.
    expect(usePreferences.getState().ready).toBe(false);
  });
});

describe("restore", () => {
  it("reads stored choices", async () => {
    stored.mockImplementation(async (key) =>
      key === "tlon.voice" ? "false" : "true",
    );
    await usePreferences.getState().restore();

    const state = usePreferences.getState();
    expect(state.voice).toBe(false);
    expect(state.developer).toBe(true);
    expect(state.ready).toBe(true);
  });

  it("treats an absent value as the default rather than false", () => {
    // Someone who has never opened Settings should still get spoken replies.
    stored.mockResolvedValue(null);
    return usePreferences
      .getState()
      .restore()
      .then(() => {
        expect(usePreferences.getState().voice).toBe(true);
        expect(usePreferences.getState().developer).toBe(false);
      });
  });

  it("becomes ready even when storage fails", async () => {
    // A locked keychain must not leave the app waiting forever on a preference.
    stored.mockRejectedValue(new Error("locked"));
    await usePreferences.getState().restore();
    expect(usePreferences.getState().ready).toBe(true);
  });

  it("falls back to safe defaults when storage fails", async () => {
    stored.mockRejectedValue(new Error("locked"));
    await usePreferences.getState().restore();
    expect(usePreferences.getState().developer).toBe(false);
  });
});

describe("changing a preference", () => {
  it("applies immediately", async () => {
    await usePreferences.getState().setVoice(false);
    expect(usePreferences.getState().voice).toBe(false);
  });

  it("persists", async () => {
    await usePreferences.getState().setDeveloper(true);
    expect(wrote).toHaveBeenCalledWith("tlon.developer", "true");
  });

  it("still applies when the write fails", async () => {
    // The switch must not appear stuck because a disk write failed. Losing the
    // choice on next launch is bad; ignoring the tap is worse.
    wrote.mockRejectedValueOnce(new Error("full"));
    await usePreferences.getState().setVoice(false);
    expect(usePreferences.getState().voice).toBe(false);
  });

  it("keeps the two settings independent", async () => {
    await usePreferences.getState().setDeveloper(true);
    expect(usePreferences.getState().voice).toBe(true);
  });
});
