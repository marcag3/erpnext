import { useAtomValue, useSetAtom } from "jotai"
import { bankRecRecordJournalEntryModalAtom, bankRecSelectedTransactionAtom, bankRecUnreconcileModalAtom, selectedBankAccountAtom } from "./bankRecAtoms"
import { DialogFooter, DialogClose } from "@/components/ui/dialog"
import _ from "@/lib/translate"
import { UnreconciledTransaction, useGetRuleForTransaction, useRefreshUnreconciledTransactions, useUpdateActionLog } from "./utils"
import { FieldValues, UseFormSetValue, useFieldArray, useForm, useFormContext, useWatch } from "react-hook-form"
import { JournalEntry } from "@/types/Accounts/JournalEntry"
import { getCompanyCostCenter, getCompanyCurrency } from "@/lib/company"
import { FrappeConfig, FrappeContext, useFrappePostCall } from "frappe-react-sdk"
import { toast } from "sonner"
import ErrorBanner from "@/components/ui/error-banner"
import { Button } from "@/components/ui/button"
import SelectedTransactionDetails from "./SelectedTransactionDetails"
import { AccountFormField, CurrencyFormField, DataField, DateField, LinkFormField, PartyTypeFormField, SmallTextField } from "@/components/ui/form-elements"
import { Form } from "@/components/ui/form"
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import AccountingDimensionField from "./AccountingDimensionField"
import {
    AccountingDimensionConfig,
    getDimensionDefaults,
    getDimensionValuesForAccount,
    isDimensionRequired,
    useJournalEntryAccountingDimensions,
} from "@/hooks/useJournalEntryAccountingDimensions"
import { TableLoader } from "@/components/ui/loaders"
import { useMultiFileUploadProgress } from "@/hooks/useMultiFileUploadProgress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { ArrowDownRight, ArrowUpRight, Plus, Trash2 } from "lucide-react"
import { evaluateAmountFormula } from "@/lib/amountFormula"
import { flt, formatCurrency } from "@/lib/numbers"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import SelectedTransactionsTable from "./SelectedTransactionsTable"
import { JournalEntryAccount } from "@/types/Accounts/JournalEntryAccount"
import { BankTransaction } from "@/types/Accounts/BankTransaction"
import FileUploadBanner from "@/components/common/FileUploadBanner"
import { Label } from "@/components/ui/label"
import { FileDropzone } from "@/components/ui/file-dropzone"
import { useGetAccounts } from "@/components/common/AccountsDropdown"
import { useHotkeys } from "react-hotkeys-hook"
const RecordBankEntryModalContent = () => {

    const selectedBankAccount = useAtomValue(selectedBankAccountAtom)

    const selectedTransaction = useAtomValue(bankRecSelectedTransactionAtom(selectedBankAccount?.name ?? ''))

    const company = selectedTransaction?.[0]?.company ?? ''
    // Forms read their default values only once, so they must mount after the config has loaded
    const { config, isLoading, error } = useJournalEntryAccountingDimensions(company)

    if (!selectedTransaction || !selectedBankAccount || selectedTransaction.length === 0) {
        return <div className='p-4'>
            <span className='text-center'>{_("No transaction selected")}</span>
        </div>
    }

    if (isLoading) {
        return <TableLoader columns={4} rows={4} />
    }

    if (error) {
        return <ErrorBanner error={error} />
    }

    if (selectedTransaction.length === 1) {
        return <BankEntryForm
            selectedTransaction={selectedTransaction[0]}
            config={config} />
    }

    return <BulkBankEntryForm
        selectedTransactions={selectedTransaction}
        config={config}
    />

}

const BulkBankEntryForm = ({ selectedTransactions, config }: { selectedTransactions: UnreconciledTransaction[], config: AccountingDimensionConfig }) => {

    const company = selectedTransactions[0]?.company ?? ''
    const dimensions = config.dimensions
    const { data: accounts } = useGetAccounts()

    const dimensionDefaults = useMemo(
        () => getDimensionDefaults(dimensions, config.defaults, company, getCompanyCostCenter),
        [dimensions, config.defaults, company],
    )

    const form = useForm<Record<string, string>>({
        defaultValues: {
            account: '',
            ...dimensionDefaults,
        },
    })

    const { call, loading, error } = useFrappePostCall<{ message: { transaction: BankTransaction, journal_entry: JournalEntry }[] }>('erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.create_bulk_bank_entry_and_reconcile')

    const onReconcile = useRefreshUnreconciledTransactions()
    const addToActionLog = useUpdateActionLog()

    const setIsOpen = useSetAtom(bankRecRecordJournalEntryModalAtom)
    const selectedAccount = form.watch('account')
    const selectedAccountReportType = accounts?.find((account) => account.name === selectedAccount)?.report_type

    const { setValue } = form
    useEffect(() => {
        if (!selectedAccount || !selectedAccountReportType) {
            return
        }

        const values = getDimensionValuesForAccount(dimensions, dimensionDefaults, config.mandatory, selectedAccountReportType)
        for (const [fieldname, value] of Object.entries(values)) {
            setValue(fieldname, value)
        }
    }, [selectedAccount, selectedAccountReportType, dimensions, dimensionDefaults, config.mandatory, setValue])

    const onSubmit = (data: Record<string, string>) => {
        const { account, ...dimensionValues } = data

        call({
            bank_transactions: selectedTransactions.map(transaction => transaction.name),
            account,
            dimensions: dimensionValues,
        }).then(({ message }) => {

            addToActionLog({
                type: 'bank_entry',
                timestamp: (new Date()).getTime(),
                isBulk: true,
                items: message.map((item) => ({
                    bankTransaction: item.transaction,
                    voucher: {
                        reference_doctype: "Journal Entry",
                        reference_name: item.journal_entry.name,
                        doc: item.journal_entry,
                        posting_date: item.journal_entry.posting_date,
                    }
                })),
                bulkCommonData: {
                    account,
                    ...dimensionValues,
                }
            })

            toast.success(_("Bank Entries Created"), {
                duration: 4000,
            })

            // Set this to the last selected transaction
            onReconcile(selectedTransactions[selectedTransactions.length - 1])
            setIsOpen(false)
        })
    }

    return <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="flex flex-col gap-4">
                {error && <ErrorBanner error={error} />}
                <SelectedTransactionsTable />

                <div className="grid grid-cols-3 gap-4">
                    <AccountFormField
                        name='account'
                        filterFunction={(acc) => {
                            // Do not allow payable and receivable accounts
                            return acc.account_type !== 'Payable' && acc.account_type !== 'Receivable'
                        }}
                        label={_('Account')}
                        isRequired
                    />
                    {dimensions.map((dimension) => (
                        <AccountingDimensionField
                            key={dimension.fieldname}
                            dimension={dimension}
                            company={company}
                            name={dimension.fieldname}
                            account={selectedAccount}
                            required={isDimensionRequired(
                                dimension.fieldname,
                                config.mandatory,
                                selectedAccountReportType,
                            )}
                        />
                    ))}
                </div>

                <DialogFooter>
                    <DialogClose asChild>
                        <Button size='md' variant={'outline'} disabled={loading}>{_("Cancel")}</Button>
                    </DialogClose>
                    <Button size='md' type='submit' disabled={loading}>{_("Submit")}</Button>
                </DialogFooter>
            </div>
        </form>
    </Form>
}


interface BankEntryFormData extends Pick<JournalEntry, 'voucher_type' | 'cheque_date' | 'posting_date' | 'cheque_no' | 'user_remark'> {
    entries: JournalEntry['accounts']
}


const BankEntryForm = ({ selectedTransaction, config }: { selectedTransaction: UnreconciledTransaction, config: AccountingDimensionConfig }) => {

    const selectedBankAccount = useAtomValue(selectedBankAccountAtom)
    const company = selectedTransaction.company ?? ''
    const dimensions = config.dimensions

    const dimensionDefaults = useMemo(
        () => getDimensionDefaults(dimensions, config.defaults, company, getCompanyCostCenter),
        [dimensions, config.defaults, company],
    )

    const { data: rule } = useGetRuleForTransaction(selectedTransaction)
    const { data: glAccounts } = useGetAccounts()

    const setIsOpen = useSetAtom(bankRecRecordJournalEntryModalAtom)

    const onClose = () => {
        setIsOpen(false)
    }

    const isWithdrawal = (selectedTransaction.withdrawal && selectedTransaction.withdrawal > 0) ? true : false

    const defaultAccounts = useMemo(() => {

        const isWithdrawal = (selectedTransaction.withdrawal && selectedTransaction.withdrawal > 0) ? true : false

        const getRowDimensions = (account?: string) => {
            const reportType = glAccounts?.find((acc) => acc.name === account)?.report_type
            if (!account || !reportType) {
                return dimensionDefaults
            }
            return getDimensionValuesForAccount(dimensions, dimensionDefaults, config.mandatory, reportType)
        }

        const accounts: Partial<JournalEntryAccount>[] = [
            {
                account: selectedBankAccount?.account ?? '',
                bank_account: selectedTransaction.bank_account,
                // Bank is debited if it's a deposit
                debit: isWithdrawal ? 0 : selectedTransaction.unallocated_amount,
                credit: isWithdrawal ? selectedTransaction.unallocated_amount : 0,
                party_type: '',
                party: '',
                ...getRowDimensions(selectedBankAccount?.account),
            }]

        // If there is no rule, we can just add the entries for the bank account transaction and the other side will be the reverse
        if (!rule) {
            accounts.push(
                {
                    account: '',
                    // Amounts will be the reverse of the bank account transaction
                    debit: isWithdrawal ? selectedTransaction.unallocated_amount : 0,
                    credit: isWithdrawal ? 0 : selectedTransaction.unallocated_amount,
                    ...getRowDimensions(),
                }
            )
        } else {
            // Rule exists, so we need to check the type of rule
            if (!rule.bank_entry_type || rule.bank_entry_type === "Single Account") {
                // Only a single account needs to be added
                accounts.push({
                    account: rule.account ?? '',
                    // Amounts will be the reverse of the bank account transaction
                    debit: isWithdrawal ? selectedTransaction.unallocated_amount : 0,
                    credit: isWithdrawal ? 0 : selectedTransaction.unallocated_amount,
                    ...getRowDimensions(rule.account),
                })
            } else {
                // For multiple accounts, we need to loop over and add entries for each
                // The last row will just be the remaining amount
                let hasTotallyEmptyRowEarlier = false;

                let totalDebits = isWithdrawal ? 0 : selectedTransaction.unallocated_amount ?? 0
                let totalCredits = isWithdrawal ? selectedTransaction.unallocated_amount ?? 0 : 0

                for (let i = 0; i < (rule.accounts?.length ?? 0); i++) {

                    const acc = rule.accounts?.[i]
                    // If it's the last row, add the difference amount
                    if (i === (rule.accounts?.length ?? 0) - 1 && !hasTotallyEmptyRowEarlier) {

                        const differenceAmount = flt(totalDebits - totalCredits, 2)
                        accounts.push({
                            account: acc?.account ?? '',
                            debit: differenceAmount > 0 ? 0 : Math.abs(differenceAmount),
                            credit: differenceAmount > 0 ? Math.abs(differenceAmount) : 0,
                            ...getRowDimensions(acc?.account),
                            user_remark: acc?.user_remark ?? '',
                        })
                    } else {

                        const transactionAmount = selectedTransaction.unallocated_amount ?? 0
                        if (!acc?.debit && !acc?.credit) {
                            hasTotallyEmptyRowEarlier = true;
                        }

                        const computedDebit = acc?.debit ? flt(evaluateAmountFormula(acc.debit, transactionAmount), 2) : 0
                        const computedCredit = acc?.credit ? flt(evaluateAmountFormula(acc.credit, transactionAmount), 2) : 0

                        totalDebits = flt(totalDebits + computedDebit, 2)
                        totalCredits = flt(totalCredits + computedCredit, 2)
                        accounts.push({
                            account: acc?.account ?? '',
                            debit: computedDebit,
                            credit: computedCredit,
                            ...getRowDimensions(acc?.account),
                            user_remark: acc?.user_remark ?? '',
                        })
                    }
                }
            }
        }

        return accounts

    }, [rule, selectedTransaction, selectedBankAccount, glAccounts, dimensions, dimensionDefaults, config.mandatory])

    const form = useForm<BankEntryFormData>({
        defaultValues: {
            voucher_type: selectedBankAccount?.is_credit_card ? 'Credit Card Entry' : 'Bank Entry',
            cheque_date: selectedTransaction.date,
            posting_date: selectedTransaction.date,
            cheque_no: (selectedTransaction.reference_number || selectedTransaction.description || '').slice(0, 140),
            user_remark: selectedTransaction.description,
            entries: defaultAccounts,
        }
    })

    const onReconcile = useRefreshUnreconciledTransactions()

    const { call: createBankEntry, loading, error, isCompleted } = useFrappePostCall<{ message: { transaction: BankTransaction, journal_entry: JournalEntry } }>('erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.create_bank_entry_and_reconcile')

    const setBankRecUnreconcileModalAtom = useSetAtom(bankRecUnreconcileModalAtom)
    const addToActionLog = useUpdateActionLog()

    const { file: frappeFile } = useContext(FrappeContext) as FrappeConfig

    const [isUploading, setIsUploading] = useState(false)
    const { uploadProgress, startTracking, updateFileProgress, resetProgress } = useMultiFileUploadProgress()

    const [files, setFiles] = useState<File[]>([])

    const onSubmit = (data: BankEntryFormData) => {

        createBankEntry({
            bank_transaction_name: selectedTransaction.name,
            ...data
        }).then(async ({ message }) => {

            addToActionLog({
                type: 'bank_entry',
                isBulk: false,
                timestamp: (new Date()).getTime(),
                items: [
                    {
                        bankTransaction: message.transaction,
                        voucher: {
                            reference_doctype: "Journal Entry",
                            reference_name: message.journal_entry.name,
                            reference_no: message.journal_entry.cheque_no,
                            reference_date: message.journal_entry.cheque_date,
                            posting_date: message.journal_entry.posting_date,
                            doc: message.journal_entry,
                        }
                    }
                ]
            })
            toast.success(_("Bank Entry Created"), {
                duration: 4000,
                closeButton: true,
                action: {
                    label: _("Undo"),
                    onClick: () => setBankRecUnreconcileModalAtom(selectedTransaction.name)
                },
                actionButtonStyle: {
                    backgroundColor: "rgb(0, 138, 46)"
                }
            })

            if (files.length > 0) {
                setIsUploading(true)
                startTracking(files.length)

                const uploadPromises = files.map((f, fileIndex) => {
                    return frappeFile.uploadFile(f, {
                        isPrivate: true,
                        doctype: "Journal Entry",
                        docname: message.journal_entry.name,
                    }, (_bytesUploaded, _totalBytes, progress) => {
                        updateFileProgress(fileIndex, progress?.progress ?? 0)
                    })
                })

                return Promise.all(uploadPromises).then(() => {
                    resetProgress()
                    setIsUploading(false)
                }).catch((error) => {
                    console.error(error)
                    toast.error(_("Error uploading attachments"), {
                        duration: 4000,
                    })
                    resetProgress()
                    setIsUploading(false)
                })
            } else {
                return Promise.resolve()
            }

        }).then(() => {
            onReconcile(selectedTransaction)
            onClose()
        })
    }


    useHotkeys('meta+s', () => {
        form.handleSubmit(onSubmit)()
    }, {
        enabled: true,
        preventDefault: true,
        enableOnFormTags: true
    })

    if (isUploading && isCompleted) {
        return <FileUploadBanner uploadProgress={uploadProgress} />
    }

    return <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className='flex flex-col gap-4'>
                {error && <ErrorBanner error={error} />}
                <div className='grid grid-cols-2 gap-4'>
                    <SelectedTransactionDetails transaction={selectedTransaction} />

                    <div className='flex flex-col gap-4'>
                        <div className='grid grid-cols-2 gap-4'>
                            <DateField
                                name='posting_date'
                                label={_("Posting Date")}
                                isRequired
                                inputProps={{ autoFocus: false }}
                            />
                            <DateField
                                name='cheque_date'
                                label={_("Reference Date")}
                                isRequired
                                inputProps={{ autoFocus: false }}
                                rules={{
                                    required: _("Reference Date is required"),
                                }}
                            />
                        </div>
                        <DataField name='cheque_no' label={_("Reference")} isRequired inputProps={{ autoFocus: false }}
                            rules={{
                                required: _("Reference is required"),
                            }} />
                    </div>
                </div>

                <div>
                    <Entries
                        company={company}
                        isWithdrawal={isWithdrawal}
                        currency={selectedTransaction.currency ?? getCompanyCurrency(company)}
                        dimensions={dimensions}
                        dimensionConfig={config}
                    />
                </div>
                <div className='flex flex-col gap-2'>
                    <div className='grid grid-cols-2 gap-4'>
                        <SmallTextField
                            name='user_remark'
                            label={_("Remarks")}
                        />
                        <div
                            data-slot="form-item"
                            className="flex flex-col gap-2"
                        >
                            <Label>{_("Attachments")}</Label>
                            <FileDropzone files={files} setFiles={setFiles} />
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <DialogClose asChild>
                        <Button size='md' variant={'outline'} disabled={loading}>{_("Cancel")}</Button>
                    </DialogClose>
                    <Button size='md' type='submit' disabled={loading}>{_("Submit")}</Button>
                </DialogFooter>
            </div>
        </form>
    </Form>

}

const Entries = ({
    company,
    isWithdrawal,
    currency,
    dimensions,
    dimensionConfig,
}: {
    company: string
    isWithdrawal: boolean
    currency: string
    dimensions: ReturnType<typeof useJournalEntryAccountingDimensions>['dimensions']
    dimensionConfig: AccountingDimensionConfig
}) => {

    const { getValues, setValue, control } = useFormContext<BankEntryFormData>()

    const entries = useWatch({ control, name: 'entries' })

    // Dimension fieldnames are only known at runtime, so they are not part of the typed form paths
    const setDimensionValue = useCallback((index: number, fieldname: string, value: string) => {
        (setValue as unknown as UseFormSetValue<FieldValues>)(`entries.${index}.${fieldname}`, value)
    }, [setValue])

    const dimensionDefaults = useMemo(
        () => getDimensionDefaults(dimensions, dimensionConfig.defaults, company, getCompanyCostCenter),
        [dimensions, dimensionConfig.defaults, company],
    )

    const { data: accounts } = useGetAccounts()

    const bankRowFallbackDimensions = useMemo(
        () => getDimensionValuesForAccount(dimensions, dimensionDefaults, dimensionConfig.mandatory, "Balance Sheet"),
        [dimensions, dimensionDefaults, dimensionConfig.mandatory],
    )

    // The bank row is read-only, so it mirrors a dimension only when all other rows agree on one value
    useEffect(() => {
        if (!entries || entries.length < 2 || dimensions.length === 0) {
            return
        }

        for (const dimension of dimensions) {
            const fieldname = dimension.fieldname as keyof JournalEntryAccount
            const values = [...new Set(entries.slice(1).map((row) => row[fieldname]).filter(Boolean))]
            const nextValue = values.length === 1 ? values[0] as string : bankRowFallbackDimensions[dimension.fieldname] || ''
            if ((entries[0]?.[fieldname] || '') !== nextValue) {
                setDimensionValue(0, dimension.fieldname, nextValue)
            }
        }
    }, [entries, setDimensionValue, dimensions, bankRowFallbackDimensions])

    const getOffsetDimensions = useCallback(() => {
        const offsetRows = getValues('entries').slice(1)
        const values: Record<string, string> = {}

        for (const dimension of dimensions) {
            const inheritedValue = offsetRows.find((row) => row[dimension.fieldname as keyof JournalEntryAccount])?.[dimension.fieldname as keyof JournalEntryAccount]
            values[dimension.fieldname] = (inheritedValue as string) || dimensionDefaults[dimension.fieldname] || ''
        }

        return values
    }, [dimensions, dimensionDefaults, getValues])

    const { call } = useContext(FrappeContext) as FrappeConfig

    const partyMapRef = useRef<Record<string, string>>({})

    const onPartyChange = (value: string, index: number) => {
        // Get the account for the party type
        if (value) {
            if (partyMapRef.current[value]) {
                setValue(`entries.${index}.account`, partyMapRef.current[value])
            } else {
                call.get('erpnext.accounts.party.get_party_account', {
                    party: value,
                    party_type: getValues(`entries.${index}.party_type`),
                    company: company
                }).then((result: { message: string }) => {
                    setValue(`entries.${index}.account`, result.message)
                    partyMapRef.current[value] = result.message
                })
            }
        } else {
            setValue(`entries.${index}.account`, '')
        }
    }

    const onAccountChange = (value: string, index: number) => {
        const reportType = value ? accounts?.find((acc) => acc.name === value)?.report_type : undefined
        const values = getDimensionValuesForAccount(dimensions, dimensionDefaults, dimensionConfig.mandatory, reportType)

        for (const [fieldname, dimensionValue] of Object.entries(values)) {
            setDimensionValue(index, fieldname, dimensionValue)
        }
    }

    const { fields, append, remove } = useFieldArray({
        control: control,
        name: 'entries'
    })

    const onAdd = useCallback(() => {
        const existingEntries = getValues('entries')
        const totalDebits = existingEntries.reduce((acc, curr) => flt(acc + (curr.debit ?? 0), 2), 0)
        const totalCredits = existingEntries.reduce((acc, curr) => flt(acc + (curr.credit ?? 0), 2), 0)

        const remainingAmount = flt(totalDebits - totalCredits, 2)

        // Remaining amount is credit if it's positive - since some debit is pending to be cleared.
        const debitAmount = remainingAmount > 0 ? 0 : Math.abs(remainingAmount)
        const creditAmount = remainingAmount > 0 ? Math.abs(remainingAmount) : 0

        append({
            party_type: '',
            party: '',
            account: '',
            debit: debitAmount,
            credit: creditAmount,
            ...getOffsetDimensions(),
        } as JournalEntryAccount, {
            focusName: `entries.${existingEntries.length}.account`
        })
    }, [append, getOffsetDimensions, getValues])

    const [selectedRows, setSelectedRows] = useState<number[]>([])

    const entryReportTypes = useMemo(
        () => (entries ?? []).map((row) => accounts?.find((acc) => acc.name === row.account)?.report_type),
        [entries, accounts],
    )

    const onSelectRow = useCallback((index: number) => {
        setSelectedRows(prev => {
            if (prev.includes(index)) {
                return prev.filter(i => i !== index)
            }
            return [...prev, index]
        })
    }, [])

    const onSelectAll = useCallback(() => {
        setSelectedRows(prev => {
            if (prev.length === fields.length) {
                return []
            }
            return [...fields.map((_, index) => index)]
        })
    }, [fields])

    const onRemove = useCallback(() => {
        // Do not remove the first row
        remove(selectedRows.filter(index => index !== 0))
        setSelectedRows([])
    }, [remove, selectedRows])

    /**
     * When add difference is clicked, check if the last row has nothing filled in.
     * If last row is empty (no debit or credit), then set that row's amount. Else, add a new row with the difference amount.
     */
    const onAddDifferenceClicked = () => {

        const existingEntries = getValues('entries')
        const totalDebits = existingEntries.reduce((acc, curr) => flt(acc + (curr.debit ?? 0), 2), 0)
        const totalCredits = existingEntries.reduce((acc, curr) => flt(acc + (curr.credit ?? 0), 2), 0)

        const lastIndex = existingEntries.length - 1

        const isLastRowEmpty = (existingEntries[lastIndex]?.debit === 0 || existingEntries[lastIndex]?.debit === undefined) && (existingEntries[lastIndex]?.credit === 0 || existingEntries[lastIndex]?.credit === undefined)

        const remainingAmount = flt(totalDebits - totalCredits, 2)

        // Remaining amount is credit if it's positive - since some debit is pending to be cleared.
        const debitAmount = remainingAmount > 0 ? 0 : Math.abs(remainingAmount)
        const creditAmount = remainingAmount > 0 ? Math.abs(remainingAmount) : 0

        if (isLastRowEmpty) {
            setValue(`entries.${lastIndex}.debit`, debitAmount)
            setValue(`entries.${lastIndex}.credit`, creditAmount)
        } else {
            append({
                party_type: '',
                party: '',
                account: '',
                debit: debitAmount,
                credit: creditAmount,
                ...getOffsetDimensions(),
            } as JournalEntryAccount, {
                focusName: `entries.${existingEntries.length}.account`
            })
        }
    }



    return <div className="flex flex-col gap-2">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead><Checkbox
                        disabled={fields.length === 0}
                        // Make this accessible to screen readers
                        aria-label={_("Select all")}
                        checked={selectedRows.length > 0 && selectedRows.length === fields.length}
                        onCheckedChange={onSelectAll} /></TableHead>
                    <TableHead>{_("Party")}</TableHead>
                    <TableHead>{_("Account")}</TableHead>
                    {dimensions.map((dimension) => (
                        <TableHead key={dimension.fieldname}>
                            {dimension.label || _(dimension.document_type)}
                        </TableHead>
                    ))}
                    <TableHead>{_("Remarks")}</TableHead>
                    <TableHead className="text-end">{_("Debit")}</TableHead>
                    <TableHead className="text-end">{_("Credit")}</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {fields.map((field, index) => (
                    <TableRow key={field.id} className={index === 0 ? 'bg-surface-gray-1 cursor-not-allowed' : ''} title={index === 0 ? _("This is the bank account entry. You cannot edit it.") : ''}>
                        <TableCell>
                            <Checkbox
                                checked={selectedRows.includes(index)}
                                onCheckedChange={() => onSelectRow(index)}
                                // Make this accessible to screen readers
                                aria-label={_("Select row {0}", [String(index + 1)])}
                                disabled={index === 0}
                            />
                        </TableCell>

                        <TableCell className="align-top">
                            <div className="flex">
                                <PartyTypeFormField
                                    name={`entries.${index}.party_type`}
                                    label={_("Party Type")}
                                    isRequired
                                    readOnly={index === 0}
                                    hideLabel
                                    inputProps={{
                                        type: isWithdrawal ? 'Payable' : 'Receivable',
                                        triggerProps: {
                                            className: 'rounded-e-none',
                                            tabIndex: -1
                                        },
                                        readOnly: index === 0,
                                    }} />
                                <PartyField index={index} onChange={onPartyChange} readOnly={index === 0} />
                            </div>

                        </TableCell>
                        <TableCell className="align-top">
                            <AccountFormField
                                name={`entries.${index}.account`}
                                label={_("Account")}
                                rules={{
                                    required: _("Account is required"),
                                    onChange: (event) => {
                                        onAccountChange(event.target.value, index)
                                    }
                                }}
                                buttonClassName="min-w-64"
                                readOnly={index === 0}
                                isRequired
                                hideLabel
                            />
                        </TableCell>
                        {dimensions.map((dimension) => (
                            <TableCell className="align-top" key={dimension.fieldname}>
                                <AccountingDimensionField
                                    dimension={dimension}
                                    company={company}
                                    name={`entries.${index}.${dimension.fieldname}`}
                                    readOnly={index === 0}
                                    account={entries?.[index]?.account}
                                    required={index !== 0 && isDimensionRequired(
                                        dimension.fieldname,
                                        dimensionConfig.mandatory,
                                        entryReportTypes[index],
                                    )}
                                />
                            </TableCell>
                        ))}
                        <TableCell className="align-top">
                            <DataField
                                name={`entries.${index}.user_remark`}
                                label={_("Remarks")}
                                readOnly={index === 0}
                                inputProps={{
                                    placeholder: _("e.g. Bank Charges"),
                                    className: 'min-w-64',
                                    readOnly: index === 0
                                }}
                                hideLabel
                            />
                        </TableCell>
                        <TableCell className={cn("text-end align-top")}>
                            <CurrencyFormField
                                name={`entries.${index}.debit`}
                                label={_("Debit")}
                                isRequired
                                hideLabel
                                readOnly={index === 0}
                                style={index === 0 ? !isWithdrawal ? {
                                    color: "var(--color-ink-gray-8)",
                                } : {} : {}}
                                currency={currency}
                                leftSlot={index === 0 && !isWithdrawal ? <Tooltip>
                                    <TooltipTrigger asChild><ArrowDownRight className="text-ink-green-3" /></TooltipTrigger>
                                    <TooltipContent>{_("Bank account debit for deposit")}</TooltipContent>
                                </Tooltip> : undefined}
                            />
                        </TableCell>
                        <TableCell className={cn("text-end align-top")}>
                            <CurrencyFormField
                                name={`entries.${index}.credit`}
                                style={index === 0 && isWithdrawal ? {
                                    color: "var(--color-ink-gray-8)",
                                } : {}}
                                label={_("Credit")}
                                isRequired
                                hideLabel
                                readOnly={index === 0}
                                currency={currency}
                                leftSlot={index === 0 && isWithdrawal ? <Tooltip>
                                    <TooltipTrigger asChild><ArrowUpRight className="text-ink-red-3" /></TooltipTrigger>
                                    <TooltipContent>{_("Bank account credit for withdrawal")}</TooltipContent>
                                </Tooltip> : undefined}
                            />
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
        <div className="flex justify-between gap-2">
            <div className="flex gap-2 justify-end">
                <div>
                    <Button size='sm' type='button' variant={'outline'} onClick={onAdd}><Plus /> {_("Add Row")}</Button>
                </div>
                {selectedRows.length > 0 && <div>
                    <Button size='sm' type='button' theme="red" onClick={onRemove}><Trash2 /> {_("Remove")}</Button>
                </div>}
            </div>
            <Summary currency={currency} addRow={onAddDifferenceClicked} />
        </div>
    </div>

}

const PartyField = ({ index, onChange, readOnly }: { index: number, onChange: (value: string, index: number) => void, readOnly: boolean }) => {

    const { control } = useFormContext<BankEntryFormData>()

    const party_type = useWatch({
        control,
        name: `entries.${index}.party_type`
    })

    if (!party_type) {
        return <DataField
            name={`entries.${index}.party`}
            label={_("Party")}
            isRequired
            inputProps={{
                disabled: true,
                className: 'rounded-s-none border-s-0 min-w-64'
            }}
            hideLabel
        />
    }

    return <LinkFormField
        name={`entries.${index}.party`}
        label={_("Party")}
        rules={{
            onChange: (event) => {
                onChange(event.target.value, index)
            },
        }}
        hideLabel
        readOnly={readOnly}
        buttonClassName="rounded-s-none border-s-0 min-w-64"
        doctype={party_type}

    />
}

const Summary = ({ currency, addRow }: { currency: string, addRow: () => void }) => {

    const { control } = useFormContext<BankEntryFormData>()

    const entries = useWatch({ control, name: 'entries' })

    const { total, totalCredits, totalDebits } = useMemo(() => {
        // Do a total debits - total credits
        const totalDebits = entries.reduce((acc, curr) => flt(acc + (curr.debit ?? 0), 2), 0)
        const totalCredits = entries.reduce((acc, curr) => flt(acc + (curr.credit ?? 0), 2), 0)
        return { total: flt(totalDebits - totalCredits, 2), totalDebits, totalCredits }
    }, [entries])

    const onAddRow = useCallback(() => {
        addRow()
    }, [addRow])

    const TextComponent = ({ className, children }: { className?: string, children: React.ReactNode }) => {
        return <span className={cn("w-32 text-end font-medium text-sm font-numeric", className)}>{children}</span>
    }

    return <div className="flex flex-col gap-2 items-end">
        <div className="flex gap-2 justify-between">
            <TextComponent>{_("Total Debit")}</TextComponent>
            <TextComponent>{formatCurrency(totalDebits, currency)}</TextComponent>
        </div>
        <div className="flex gap-2 justify-between">
            <TextComponent>{_("Total Credit")}</TextComponent>
            <TextComponent>{formatCurrency(totalCredits, currency)}</TextComponent>
        </div>
        {total !== 0 && <div className="flex gap-2 justify-between">
            <TextComponent>{_("Difference")}</TextComponent>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button type='button' variant='link' className="p-0 text-ink-red-3 underline h-fit" role='button' onClick={onAddRow}>
                        <TextComponent className='text-ink-red-3'>{formatCurrency(total, currency)}</TextComponent>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    {_("Add a row with the difference amount")}
                </TooltipContent>
            </Tooltip>
        </div>}

    </div>

}



export default RecordBankEntryModalContent
