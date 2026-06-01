"use client";

import React, { useReducer, useCallback, useState, useId } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  kycFlowReducer,
  initialKycFlowState,
  type KycStep,
} from "@/lib/kyc-flow";

const STEPS: KycStep[] = ["personal", "address", "documents", "review"];
const TOTAL_STEPS = STEPS.length;

const stepVariants: Variants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 48 : -48,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -48 : 48,
    opacity: 0,
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  }),
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-pluto-900">
        {label}
      </label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p
            id={`${id}-error`}
            role="alert"
            className="text-xs text-red-600"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function KycSubmissionForm() {
  const t = useTranslations();
  const uid = useId();
  const [state, dispatch] = useReducer(kycFlowReducer, initialKycFlowState);
  const [direction, setDirection] = useState(1);
  const [announcement, setAnnouncement] = useState("");
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});

  const stepIndex = STEPS.indexOf(state.currentStep);

  const validateCurrentStep = useCallback((): boolean => {
    const errs: Record<string, string> = {};

    if (state.currentStep === "personal") {
      if (!state.personal.firstName.trim()) errs.firstName = t("required") || "Required";
      if (!state.personal.lastName.trim()) errs.lastName = t("required") || "Required";
    }

    setStepErrors(errs);
    return Object.keys(errs).length === 0;
  }, [state.currentStep, state.personal, t]);

  const goNext = useCallback(() => {
    if (!validateCurrentStep()) {
      setAnnouncement(t("validationError") || "Please fill required fields");
      return;
    }
    if (stepIndex < TOTAL_STEPS - 1) {
      setDirection(1);
      dispatch({ type: "SET_STEP", step: STEPS[stepIndex + 1]! });
      setStepErrors({});
      setAnnouncement(
        `${t("step") || "Step"} ${stepIndex + 2} ${t("of") || "of"} ${TOTAL_STEPS}`,
      );
    }
  }, [validateCurrentStep, stepIndex, t]);

  const goBack = useCallback(() => {
    if (stepIndex > 0) {
      setDirection(-1);
      dispatch({ type: "SET_STEP", step: STEPS[stepIndex - 1]! });
      setStepErrors({});
    }
  }, [stepIndex]);

  const handleSubmit = useCallback(async () => {
    dispatch({ type: "SUBMIT" });
    setAnnouncement(t("submitting") || "Submitting...");

    try {
      const res = await fetch("/api/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personal: state.personal,
          address: state.address,
          documents: {
            idType: state.documents.idType,
            idNumber: state.documents.idNumber,
          },
        }),
      });

      if (!res.ok) throw new Error(t("submitError") || "Submission failed");

      dispatch({ type: "SUBMIT_SUCCESS", submittedAt: new Date().toISOString() });
      setAnnouncement(t("successTitle") || "KYC submitted successfully!");
      toast.success(t("successTitle") || "KYC submitted successfully!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: "SUBMIT_FAILURE", error: msg });
      setAnnouncement(msg);
      toast.error(msg);
    }
  }, [state, t]);

  if (state.submittedAt) {
    return (
      <div
        className="w-full max-w-2xl mx-auto"
        role="region"
        aria-label={t("kycForm") || "KYC Submission Form"}
      >
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </div>
        <motion.div
          className="flex flex-col items-center gap-6 rounded-3xl border border-pluto-100 bg-white p-10 shadow-lg text-center"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
        >
          <motion.div
            className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          >
            <svg
              className="h-8 w-8 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </motion.div>

          <h2 className="text-2xl font-bold text-pluto-900" aria-live="assertive">
            {t("successTitle")}
          </h2>
          <p className="text-pluto-600">
            {t("successDescription") ||
              "Your KYC verification has been submitted and is under review."}
          </p>

          <button
            type="button"
            onClick={() => dispatch({ type: "RESET" })}
            className="rounded-xl bg-pluto-600 px-8 py-3 font-semibold text-white hover:bg-pluto-700 focus:outline-none focus:ring-2 focus:ring-pluto-400"
          >
            {t("submitAnother")}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="w-full max-w-2xl mx-auto"
      role="region"
      aria-label={t("kycForm") || "KYC Submission Form"}
    >
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <div className="rounded-3xl border border-pluto-100 bg-white p-8 shadow-lg space-y-6">
        <div
          role="progressbar"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-label={`${t("step") || "Step"} ${stepIndex + 1} ${t("of") || "of"} ${TOTAL_STEPS}`}
          className="space-y-2"
        >
          <div className="flex justify-between text-xs text-pluto-600">
            <span>
              {stepIndex + 1} of {TOTAL_STEPS}
            </span>
          </div>
          <div className="flex gap-2" role="list" aria-label={t("steps") || "Steps"}>
            {STEPS.map((s, i) => (
              <div
                key={s}
                role="listitem"
                aria-current={i === stepIndex ? "step" : undefined}
                className={`h-2 flex-1 rounded-full transition-colors duration-300 ${
                  i <= stepIndex ? "bg-pluto-600" : "bg-pluto-100"
                }`}
              />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={state.currentStep}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="space-y-4"
          >
            {state.currentStep === "personal" && (
              <section aria-labelledby={`${uid}-personal-title`} className="space-y-4">
                <h2 id={`${uid}-personal-title`} className="text-xl font-bold text-pluto-900">
                  {t("personalInfo")}
                </h2>

                <div className="grid grid-cols-2 gap-4">
                  <Field
                    id={`${uid}-firstName`}
                    label={t("firstName") || "First Name"}
                    error={stepErrors.firstName}
                  >
                    <input
                      id={`${uid}-firstName`}
                      type="text"
                      placeholder={t("firstName")}
                      value={state.personal.firstName}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_PERSONAL", data: { firstName: e.target.value } })
                      }
                      aria-required="true"
                      aria-invalid={!!stepErrors.firstName}
                      aria-describedby={
                        stepErrors.firstName ? `${uid}-firstName-error` : undefined
                      }
                      className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                    />
                  </Field>

                  <Field
                    id={`${uid}-lastName`}
                    label={t("lastName") || "Last Name"}
                    error={stepErrors.lastName}
                  >
                    <input
                      id={`${uid}-lastName`}
                      type="text"
                      placeholder={t("lastName")}
                      value={state.personal.lastName}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_PERSONAL", data: { lastName: e.target.value } })
                      }
                      aria-required="true"
                      aria-invalid={!!stepErrors.lastName}
                      aria-describedby={
                        stepErrors.lastName ? `${uid}-lastName-error` : undefined
                      }
                      className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                    />
                  </Field>
                </div>

                <Field id={`${uid}-email`} label={t("email") || "Email"}>
                  <input
                    id={`${uid}-email`}
                    type="email"
                    placeholder={t("email")}
                    value={state.personal.nationality}
                    onChange={(e) =>
                      dispatch({ type: "UPDATE_PERSONAL", data: { nationality: e.target.value } })
                    }
                    className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                  />
                </Field>

                <Field id={`${uid}-dateOfBirth`} label={t("dateOfBirth") || "Date of Birth"}>
                  <input
                    id={`${uid}-dateOfBirth`}
                    type="date"
                    value={state.personal.dateOfBirth}
                    onChange={(e) =>
                      dispatch({ type: "UPDATE_PERSONAL", data: { dateOfBirth: e.target.value } })
                    }
                    className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                  />
                </Field>
              </section>
            )}

            {state.currentStep === "address" && (
              <section aria-labelledby={`${uid}-address-title`} className="space-y-4">
                <h2 id={`${uid}-address-title`} className="text-xl font-bold text-pluto-900">
                  {t("addressInfo")}
                </h2>

                <Field id={`${uid}-street`} label={t("street") || "Street"}>
                  <input
                    id={`${uid}-street`}
                    type="text"
                    placeholder={t("street")}
                    value={state.address.street}
                    onChange={(e) =>
                      dispatch({ type: "UPDATE_ADDRESS", data: { street: e.target.value } })
                    }
                    className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field id={`${uid}-city`} label={t("city") || "City"}>
                    <input
                      id={`${uid}-city`}
                      type="text"
                      placeholder={t("city")}
                      value={state.address.city}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_ADDRESS", data: { city: e.target.value } })
                      }
                      className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                    />
                  </Field>

                  <Field id={`${uid}-addressState`} label={t("state") || "State"}>
                    <input
                      id={`${uid}-addressState`}
                      type="text"
                      placeholder={t("state")}
                      value={state.address.state}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_ADDRESS", data: { state: e.target.value } })
                      }
                      className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field id={`${uid}-postalCode`} label={t("postalCode") || "Postal Code"}>
                    <input
                      id={`${uid}-postalCode`}
                      type="text"
                      placeholder={t("postalCode")}
                      value={state.address.postalCode}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_ADDRESS", data: { postalCode: e.target.value } })
                      }
                      className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                    />
                  </Field>

                  <Field id={`${uid}-country`} label={t("country") || "Country"}>
                    <input
                      id={`${uid}-country`}
                      type="text"
                      placeholder={t("country")}
                      value={state.address.country}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_ADDRESS", data: { country: e.target.value } })
                      }
                      className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                    />
                  </Field>
                </div>
              </section>
            )}

            {state.currentStep === "documents" && (
              <section aria-labelledby={`${uid}-docs-title`} className="space-y-4">
                <h2 id={`${uid}-docs-title`} className="text-xl font-bold text-pluto-900">
                  {t("documents")}
                </h2>

                <Field id={`${uid}-idType`} label={t("idType") || "ID Type"}>
                  <select
                    id={`${uid}-idType`}
                    value={state.documents.idType}
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_DOCUMENTS",
                        data: {
                          idType: e.target.value as
                            | "passport"
                            | "drivers_license"
                            | "national_id"
                            | "",
                        },
                      })
                    }
                    className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                  >
                    <option value="">{t("selectIdType") || "Select ID type"}</option>
                    <option value="passport">{t("passport") || "Passport"}</option>
                    <option value="drivers_license">
                      {t("driversLicense") || "Driver's License"}
                    </option>
                    <option value="national_id">{t("nationalId") || "National ID"}</option>
                  </select>
                </Field>

                <Field id={`${uid}-idNumber`} label={t("idNumber") || "ID Number"}>
                  <input
                    id={`${uid}-idNumber`}
                    type="text"
                    placeholder={t("idNumber")}
                    value={state.documents.idNumber}
                    onChange={(e) =>
                      dispatch({ type: "UPDATE_DOCUMENTS", data: { idNumber: e.target.value } })
                    }
                    className="rounded-xl border border-pluto-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400"
                  />
                </Field>

                <Field id={`${uid}-idFront`} label={t("idFront") || "ID Front"}>
                  <input
                    id={`${uid}-idFront`}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_DOCUMENTS",
                        data: { idFrontFile: e.target.files?.[0] ?? null },
                      })
                    }
                    className="rounded-xl border border-pluto-200 px-4 py-3 file:mr-4 file:rounded-lg file:border-0 file:bg-pluto-100 file:px-4 file:py-2 file:text-sm"
                  />
                </Field>

                <Field id={`${uid}-idBack`} label={t("idBack") || "ID Back"}>
                  <input
                    id={`${uid}-idBack`}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_DOCUMENTS",
                        data: { idBackFile: e.target.files?.[0] ?? null },
                      })
                    }
                    className="rounded-xl border border-pluto-200 px-4 py-3 file:mr-4 file:rounded-lg file:border-0 file:bg-pluto-100 file:px-4 file:py-2 file:text-sm"
                  />
                </Field>

                <Field id={`${uid}-selfie`} label={t("selfie") || "Selfie"}>
                  <input
                    id={`${uid}-selfie`}
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_DOCUMENTS",
                        data: { selfieFile: e.target.files?.[0] ?? null },
                      })
                    }
                    className="rounded-xl border border-pluto-200 px-4 py-3 file:mr-4 file:rounded-lg file:border-0 file:bg-pluto-100 file:px-4 file:py-2 file:text-sm"
                  />
                </Field>
              </section>
            )}

            {state.currentStep === "review" && (
              <section aria-labelledby={`${uid}-review-title`} className="space-y-4">
                <h2 id={`${uid}-review-title`} className="text-xl font-bold text-pluto-900">
                  {t("review")}
                </h2>

                <dl className="divide-y divide-pluto-100 rounded-xl border border-pluto-100 text-sm">
                  {[
                    { label: t("firstName") || "First Name", value: state.personal.firstName },
                    { label: t("lastName") || "Last Name", value: state.personal.lastName },
                    {
                      label: t("dateOfBirth") || "Date of Birth",
                      value: state.personal.dateOfBirth,
                    },
                    { label: t("city") || "City", value: state.address.city },
                    { label: t("country") || "Country", value: state.address.country },
                    { label: t("idType") || "ID Type", value: state.documents.idType },
                    { label: t("idNumber") || "ID Number", value: state.documents.idNumber },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between px-4 py-2">
                      <dt className="font-medium text-pluto-600">{label}</dt>
                      <dd className="text-pluto-900">{value || "—"}</dd>
                    </div>
                  ))}
                </dl>

                {state.error && (
                  <motion.p
                    role="alert"
                    className="text-sm text-red-600"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    {state.error}
                  </motion.p>
                )}
              </section>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="flex gap-4 pt-2">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0}
            className="flex-1 rounded-xl border border-pluto-200 bg-white px-6 py-3 font-semibold text-pluto-900 hover:bg-pluto-50 focus:outline-none focus:ring-2 focus:ring-pluto-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("back")}
          </button>

          {state.currentStep !== "review" ? (
            <button
              type="button"
              onClick={goNext}
              className="flex-1 rounded-xl bg-pluto-600 px-6 py-3 font-semibold text-white hover:bg-pluto-700 focus:outline-none focus:ring-2 focus:ring-pluto-400"
            >
              {t("next")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={state.isSubmitting}
              aria-describedby={`${uid}-submit-status`}
              className="flex-1 rounded-xl bg-pluto-600 px-6 py-3 font-semibold text-white hover:bg-pluto-700 focus:outline-none focus:ring-2 focus:ring-pluto-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state.isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <motion.span
                    className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    aria-hidden="true"
                  />
                  {t("submitting") || "Submitting..."}
                </span>
              ) : (
                t("submit")
              )}
            </button>
          )}
        </div>

        <div id={`${uid}-submit-status`} className="sr-only" aria-live="polite">
          {state.isSubmitting && (t("submitting") || "Submitting your KYC information...")}
        </div>
      </div>
    </div>
  );
}

export default KycSubmissionForm;
