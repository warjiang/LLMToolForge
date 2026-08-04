import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { SummaryReportLinks } from "../SummaryReportLinks";

describe("summary report links", () => {
  test("opens the selected report from the final summary", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const reports = [
      {
        kind: "browser" as const,
        dir: "/workspace/report",
        title: "行业调研报告",
      },
    ];

    render(
      <SummaryReportLinks
        reports={reports}
        openLabel="打开报告"
        onOpen={onOpen}
      />
    );

    expect(screen.getByText("行业调研报告")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "打开报告" }));
    expect(onOpen).toHaveBeenCalledWith(reports[0]);
  });
});
