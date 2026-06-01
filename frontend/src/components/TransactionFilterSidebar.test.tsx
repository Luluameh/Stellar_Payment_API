/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import TransactionFilterSidebar from "./TransactionFilterSidebar";
import React from "react";
import "@testing-library/jest-dom/vitest";

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    aside: ({ children, ...props }: any) => <aside {...props}>{children}</aside>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    button: ({ children, onClick, disabled, className, type }: any) => (
      <button onClick={onClick} disabled={disabled} className={className} type={type}>
        {children}
      </button>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe("TransactionFilterSidebar", () => {
  const defaultFilters = {
    search: "",
    status: "all",
    asset: "all",
    dateFrom: "",
    dateTo: "",
  };

  const mockProps = {
    filters: defaultFilters,
    onFilterChange: vi.fn(),
    onClearFilter: vi.fn(),
    onClearAll: vi.fn(),
    hasActiveFilters: false,
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  describe("Rendering", () => {
    it("renders all filter sections", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      expect(screen.getAllByText("Filters").length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText(/Search/i).length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText(/Status/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Asset/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Date Range/i).length).toBeGreaterThan(0);
    });

    it("displays current filter values", () => {
      const activeFilters = {
        search: "test-id",
        status: "confirmed",
        asset: "USDC",
        dateFrom: "2023-01-01",
        dateTo: "2023-12-31",
      };

      render(<TransactionFilterSidebar {...mockProps} filters={activeFilters} />);

      const searchInputs = screen.getAllByLabelText(/Search/i);
      expect(searchInputs[0]).toHaveValue("test-id");

      const statusSelects = screen.getAllByLabelText(/Status/i);
      expect(statusSelects[0]).toHaveValue("confirmed");

      const usdcButtons = screen.getAllByRole("button", { name: /^USDC$/i });
      expect(usdcButtons[0]).toHaveClass("bg-[var(--pluto-500)]");
    });
  });

  // ── Optimistic Interactions ────────────────────────────────────────────────

  describe("Optimistic interactions", () => {
    it("calls onFilterChange immediately on search input (no debounce in component)", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      const searchInputs = screen.getAllByLabelText(/Search/i);
      fireEvent.change(searchInputs[0], { target: { value: "new search" } });

      expect(mockProps.onFilterChange).toHaveBeenCalledTimes(1);
      expect(mockProps.onFilterChange).toHaveBeenCalledWith("search", "new search");
    });

    it("calls onFilterChange immediately on status change", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      const statusSelects = screen.getAllByLabelText(/Status/i);
      fireEvent.change(statusSelects[0], { target: { value: "failed" } });

      expect(mockProps.onFilterChange).toHaveBeenCalledWith("status", "failed");
    });

    it("calls onFilterChange immediately on asset button click", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      const xlmButtons = screen.getAllByRole("button", { name: /^XLM$/i });
      fireEvent.click(xlmButtons[0]);

      expect(mockProps.onFilterChange).toHaveBeenCalledWith("asset", "XLM");
    });

    it("calls onFilterChange immediately on date change", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      const fromInputs = screen.getAllByLabelText(/From/i, { selector: "input" });
      fireEvent.change(fromInputs[0], { target: { value: "2024-01-01" } });

      expect(mockProps.onFilterChange).toHaveBeenCalledWith("dateFrom", "2024-01-01");
    });

    it("calls onClearFilter when clear-search button is clicked", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, search: "something" }}
        />,
      );

      const clearButtons = screen.getAllByLabelText(/Clear search/i);
      fireEvent.click(clearButtons[0]);

      expect(mockProps.onClearFilter).toHaveBeenCalledWith("search");
    });
  });

  // ── Filter Management ──────────────────────────────────────────────────────

  describe("Filter management", () => {
    it("calls onClearAll when Clear All Filters button is clicked", () => {
      render(<TransactionFilterSidebar {...mockProps} hasActiveFilters={true} />);

      const clearAllButtons = screen.getAllByRole("button", { name: /Clear All Filters/i });
      fireEvent.click(clearAllButtons[0]);

      expect(mockProps.onClearAll).toHaveBeenCalled();
    });

    it("disables Clear All button when no active filters", () => {
      render(<TransactionFilterSidebar {...mockProps} hasActiveFilters={false} />);

      const clearAllButtons = screen.getAllByRole("button", { name: /Clear All Filters/i });
      expect(clearAllButtons[0]).toBeDisabled();
    });

    it("enables Clear All button when hasActiveFilters is true", () => {
      render(<TransactionFilterSidebar {...mockProps} hasActiveFilters={true} />);

      const clearAllButtons = screen.getAllByRole("button", { name: /Clear All Filters/i });
      expect(clearAllButtons[0]).not.toBeDisabled();
    });
  });

  // ── Optimistic visual feedback ─────────────────────────────────────────────

  describe("Optimistic visual feedback — searchSyncPending", () => {
    it("sets aria-busy on search input when searchSyncPending is true", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, search: "pending-query" }}
          searchSyncPending
        />,
      );

      const searchInputs = screen.getAllByLabelText(/Search/i);
      expect(searchInputs[0]).toHaveAttribute("aria-busy", "true");
    });

    it("does NOT set aria-busy on search when searchSyncPending is false", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      const searchInputs = screen.getAllByLabelText(/Search/i);
      expect(searchInputs[0]).toHaveAttribute("aria-busy", "false");
    });

    it("shows 'Applying to results…' hint text when searchSyncPending", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, search: "q" }}
          searchSyncPending
        />,
      );

      expect(screen.getAllByText(/Applying to results/i).length).toBeGreaterThan(0);
    });

    it("hides 'Applying to results…' hint when searchSyncPending is false", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      expect(screen.queryByText(/Applying to results/i)).not.toBeInTheDocument();
    });

    it("applies dashed border class to search input when searchSyncPending", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, search: "q" }}
          searchSyncPending
        />,
      );

      const searchInputs = screen.getAllByLabelText(/Search/i);
      expect(searchInputs[0].className).toContain("border-dashed");
    });
  });

  describe("Optimistic visual feedback — isFilterPending", () => {
    it("sets aria-busy on status select when isFilterPending is true", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, status: "pending" }}
          isFilterPending
        />,
      );

      const statusSelects = screen.getAllByLabelText(/Status/i);
      expect(statusSelects[0]).toHaveAttribute("aria-busy", "true");
    });

    it("applies dashed border to status select when isFilterPending", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, status: "confirmed" }}
          isFilterPending
        />,
      );

      const statusSelects = screen.getAllByLabelText(/Status/i);
      expect(statusSelects[0].className).toContain("border-dashed");
    });

    it("applies pending opacity to active asset button when isFilterPending", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, asset: "XLM" }}
          isFilterPending
        />,
      );

      const xlmButtons = screen.getAllByRole("button", { name: /^XLM$/i });
      expect(xlmButtons[0].className).toContain("opacity-70");
    });

    it("shows aria-pressed on active asset button", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, asset: "USDC" }}
        />,
      );

      const usdcButtons = screen.getAllByRole("button", { name: /^USDC$/i });
      expect(usdcButtons[0]).toHaveAttribute("aria-pressed", "true");
    });

    it("inactive asset buttons have aria-pressed='false'", () => {
      render(
        <TransactionFilterSidebar
          {...mockProps}
          filters={{ ...defaultFilters, asset: "USDC" }}
        />,
      );

      const xlmButtons = screen.getAllByRole("button", { name: /^XLM$/i });
      expect(xlmButtons[0]).toHaveAttribute("aria-pressed", "false");
    });
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  describe("Accessibility", () => {
    it("has proper ARIA role on mobile drawer", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      expect(
        screen.getByRole("dialog", { name: /Filter sidebar/i }),
      ).toBeInTheDocument();
    });

    it("calls onClose when close button is clicked (mobile)", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      const closeButtons = screen.getAllByLabelText(/Close filters/i);
      fireEvent.click(closeButtons[0]);

      expect(mockProps.onClose).toHaveBeenCalled();
    });

    it("asset button group has accessible group label", () => {
      render(<TransactionFilterSidebar {...mockProps} />);

      expect(
        screen.getAllByRole("group", { name: /Asset filter/i }).length,
      ).toBeGreaterThan(0);
    });
  });
});