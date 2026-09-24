import { useFrappeGetCall } from "frappe-react-sdk"
import { useMemo } from "react"

export interface AccountingDimension {
    fieldname: string
    label?: string
    document_type: string
}

export interface MandatoryDimensionConfig {
    label: string
    mandatory_for_pl: number
    mandatory_for_bs: number
}

export interface AccountingDimensionConfig {
    enabled: boolean
    dimensions: AccountingDimension[]
    defaults: Record<string, string>
    mandatory: Record<string, MandatoryDimensionConfig>
}

const EMPTY_CONFIG: AccountingDimensionConfig = {
    enabled: false,
    dimensions: [],
    defaults: {},
    mandatory: {},
}

export const useJournalEntryAccountingDimensions = (company: string) => {
    const { data, error, isLoading } = useFrappeGetCall<{ message: AccountingDimensionConfig }>(
        "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.get_accounting_dimension_config",
        { company },
        company ? undefined : null,
        {
            revalidateOnFocus: false,
        },
    )

    const config = useMemo(() => data?.message ?? EMPTY_CONFIG, [data])

    return {
        config,
        dimensions: config.dimensions,
        error,
        isLoading,
    }
}

export const getDimensionDefaults = (
    dimensions: AccountingDimension[],
    defaults: Record<string, string>,
    company: string,
    getCompanyCostCenter: (company: string) => string | undefined,
) => {
    const values: Record<string, string> = {}

    for (const dimension of dimensions) {
        if (dimension.fieldname === "cost_center") {
            values[dimension.fieldname] = defaults[dimension.fieldname] || getCompanyCostCenter(company) || ""
        } else {
            values[dimension.fieldname] = defaults[dimension.fieldname] || ""
        }
    }

    return values
}

export const isDimensionRequired = (
    fieldname: string,
    mandatory: Record<string, MandatoryDimensionConfig>,
    reportType?: string,
) => {
    const config = mandatory[fieldname]
    if (!config || !reportType) {
        return false
    }

    if (reportType === "Profit and Loss") {
        return Boolean(config.mandatory_for_pl)
    }

    if (reportType === "Balance Sheet") {
        return Boolean(config.mandatory_for_bs)
    }

    return false
}

/**
 * Dimension values a row should get when its account is (re)selected.
 * Profit and Loss accounts get the defaults; Balance Sheet accounts only get defaults
 * for dimensions that are mandatory for Balance Sheet accounts.
 */
export const getDimensionValuesForAccount = (
    dimensions: AccountingDimension[],
    dimensionDefaults: Record<string, string>,
    mandatory: Record<string, MandatoryDimensionConfig>,
    reportType?: string,
) => {
    const values: Record<string, string> = {}

    for (const dimension of dimensions) {
        const shouldDefault = reportType === "Profit and Loss" || isDimensionRequired(dimension.fieldname, mandatory, reportType)
        values[dimension.fieldname] = shouldDefault ? dimensionDefaults[dimension.fieldname] || "" : ""
    }

    return values
}
