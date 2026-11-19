/** Explicit opt-in. Existing non-module screens and global typography stay unchanged. */
import React from "react";
import * as Base from "./ui";
export const AppBar = (props: React.ComponentProps<typeof Base.AppBar>) => (
  <Base.AppBar {...props} refinement="b" />
);
export const IconButton = (
  props: React.ComponentProps<typeof Base.IconButton>,
) => <Base.IconButton {...props} refinement="b" />;
export const SegmentedControl = (
  props: React.ComponentProps<typeof Base.SegmentedControl>,
) => <Base.SegmentedControl {...props} refinement="b" />;
export const FilterChips = (
  props: React.ComponentProps<typeof Base.FilterChips>,
) => <Base.FilterChips {...props} refinement="b" />;
