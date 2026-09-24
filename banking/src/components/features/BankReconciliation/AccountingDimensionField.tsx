import { LinkFormField } from "@/components/ui/form-elements"
import _ from "@/lib/translate"
import { AccountingDimension } from "@/hooks/useJournalEntryAccountingDimensions"

const getDimensionQuery = (dimension: AccountingDimension, company: string, account?: string): { query: string, filters: Record<string, string> } => {
    if (dimension.fieldname === "project") {
        return {
            query: "erpnext.controllers.queries.get_project_name",
            filters: { company },
        }
    }

    return {
        query: "erpnext.controllers.queries.get_filtered_dimensions",
        filters: {
            dimension: dimension.fieldname,
            company,
            account: account || "",
        },
    }
}

interface AccountingDimensionFieldProps {
    dimension: AccountingDimension
    company: string
    name: string
    readOnly?: boolean
    account?: string
    required?: boolean
    buttonClassName?: string
}

const AccountingDimensionField = ({
    dimension,
    company,
    name,
    readOnly,
    account,
    required,
    buttonClassName = "min-w-48",
}: AccountingDimensionFieldProps) => {
    const label = dimension.label || _(dimension.document_type)

    return (
        <LinkFormField
            doctype={dimension.document_type}
            reference_doctype="Journal Entry Account"
            name={name}
            label={label}
            customQuery={getDimensionQuery(dimension, company, account)}
            buttonClassName={buttonClassName}
            readOnly={readOnly}
            hideLabel
            rules={required ? { required: _("{0} is required", [label]) } : undefined}
        />
    )
}

export default AccountingDimensionField
