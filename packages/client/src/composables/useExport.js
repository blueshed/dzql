/**
 * Composable for exporting data in various formats
 */
export function useExport() {
  /**
   * Export data as CSV
   */
  const exportToCSV = (data, filename = 'export.csv') => {
    if (!data || data.length === 0) {
      throw new Error('No data to export')
    }

    // Get headers from first object
    const headers = Object.keys(data[0])

    // Create CSV content
    const csvContent = [
      // Header row
      headers.map(h => `"${h}"`).join(','),
      // Data rows
      ...data.map(row =>
        headers.map(header => {
          const value = row[header]
          if (value === null || value === undefined) return '""'
          if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`
          return `"${String(value).replace(/"/g, '""')}"`
        }).join(',')
      )
    ].join('\n')

    // Download file
    downloadFile(csvContent, filename, 'text/csv;charset=utf-8;')
  }

  /**
   * Export data as JSON
   */
  const exportToJSON = (data, filename = 'export.json') => {
    if (!data) {
      throw new Error('No data to export')
    }

    const jsonContent = JSON.stringify(data, null, 2)
    downloadFile(jsonContent, filename, 'application/json;charset=utf-8;')
  }

  /**
   * Helper function to download a file
   */
  const downloadFile = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  /**
   * Copy data to clipboard as JSON
   */
  const copyToClipboard = async (data) => {
    try {
      const text = JSON.stringify(data, null, 2)
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
      return false
    }
  }

  return {
    exportToCSV,
    exportToJSON,
    copyToClipboard
  }
}
