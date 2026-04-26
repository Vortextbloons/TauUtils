import type { ActionType, FormLayout } from "./core";

export type UIButtonElement = {
  kind: "button";
  text: string;
  iconPath?: string;
  action: ActionType;
  value?: string;
};

export type UIToggleElement = {
  kind: "toggle";
  label: string;
  defaultValue?: boolean;
  action: ActionType;
  value?: string;
};

export type UISliderElement = {
  kind: "slider";
  label: string;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  action: ActionType;
  value?: string;
};

export type UIDropdownElement = {
  kind: "dropdown";
  label: string;
  options: string[];
  defaultValueIndex?: number;
  action: ActionType;
  value?: string;
};

export type UIInputElement = {
  kind: "input";
  label: string;
  placeholder?: string;
  defaultValue?: string;
  action: ActionType;
  value?: string;
};

export type UILabelElement = {
  kind: "label";
  text: string;
};

export type UIDividerElement = {
  kind: "divider";
};

export type FormElement =
  | UIButtonElement
  | UIToggleElement
  | UISliderElement
  | UIDropdownElement
  | UIInputElement
  | UILabelElement
  | UIDividerElement;

export type FormDefinition = {
  id: string;
  title: string;
  body?: string;
  layout: FormLayout;
  elements: FormElement[];
};
