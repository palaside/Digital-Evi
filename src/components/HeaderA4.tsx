// src/components/HeaderA4.tsx
"use client";

import React from "react";
import { headerConfig } from "@/config/headerConfig";
import "@/styles/headerA4.css";

export interface HeaderA4Props {
  title?: string;
  subtitle?: string;
  logoUrl?: string;
}

export const HeaderA4: React.FC<HeaderA4Props> = ({
  title = headerConfig.title,
  subtitle = headerConfig.subtitle,
  logoUrl = headerConfig.logoUrl,
}) => {
  const alignment = headerConfig.alignment; // left | center | right
  const style: React.CSSProperties = {
    justifyContent:
      alignment === "left"
        ? "flex-start"
        : alignment === "right"
        ? "flex-end"
        : "center",
    fontFamily: headerConfig.fontFamily,
    fontSize: headerConfig.fontSize,
    color: headerConfig.color,
  };

  return (
    <div className="header-a4" style={style}>
      {logoUrl && <img src={logoUrl} alt="logo" />}
      <div className="header-text">
        <div className="title">{title}</div>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
    </div>
  );
};
