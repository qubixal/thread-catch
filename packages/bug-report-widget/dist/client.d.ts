import * as react from 'react';
export { S as Severity } from './shared-Dd5jsEYr.js';

type BugReportWidgetProps = {
    /** The server route created by `thread-catch init` */
    endpoint?: string;
    /** Product name shown in the panel heading */
    productName?: string;
};
declare function BugReportWidget({ endpoint, productName }: BugReportWidgetProps): react.JSX.Element;

export { BugReportWidget, type BugReportWidgetProps };
