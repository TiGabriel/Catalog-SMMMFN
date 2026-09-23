import { z } from "zod";

/** Romanian fallback messages for validation issues without an explicit message. */
z.config({
  customError: (issue) => {
    switch (issue.code) {
      case "invalid_type":
        return issue.input === undefined ? "Câmp obligatoriu." : "Tip de valoare invalid.";
      case "too_small":
        return "Valoare prea mică sau prea scurtă.";
      case "too_big":
        return "Valoare prea mare sau prea lungă.";
      case "invalid_format":
        return "Format invalid.";
      case "invalid_value":
        return "Valoare nepermisă.";
      case "unrecognized_keys":
        return "Câmpuri nepermise în cerere.";
      default:
        return "Valoare invalidă.";
    }
  },
});
