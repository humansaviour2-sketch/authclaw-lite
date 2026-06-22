"""
Shared utility functions for compliance checking, severity calculations, and related mappings.
"""

def calculate_severity(entity_count: int) -> str:
    """
    Calculate the severity of a finding or evidence based on the number of detected sensitive entities.
    
    Mapping:
    - 1-3 entities: medium
    - 4-10 entities: high
    - 11+ entities: critical
    """
    if entity_count >= 11:
        return "critical"
    elif entity_count >= 4:
        return "high"
    elif entity_count >= 1:
        return "medium"
    return "info"
